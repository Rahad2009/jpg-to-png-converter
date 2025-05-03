import express from "express";
import fs from "fs"; // Imported but not used in this snippet - can be removed if not used elsewhere
import path from "path";
import multer from "multer";
import sharp from "sharp"; // Sharp is a high-performance image processing library
import archiver from "archiver"; // Import archiver for zip creation
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Temporary storage for processed image buffers
// In a production environment, consider more robust storage (e.g., disk, cloud storage)
// NOTE: This in-memory storage is simple but has limitations for concurrent users
// and memory usage. It's cleared on each new /compress request.
// POTENTIAL BOTTLENECK 1: In-memory storage can consume significant RAM,
// especially with large batches or large images, potentially leading to
// performance degradation or crashes if memory limits are hit.
const processedImages = {}; // Object to store { outputFilename: buffer } pairs

// Middleware to serve static files (like your index.html, logo.png, sitemap.xml, robots.txt)
app.use(express.static(__dirname));

// Serve main HTML file when accessing the root URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Multer setup: Use memoryStorage to keep files in memory as buffers
const storage = multer.memoryStorage();
// Configure multer to accept an array of files with the field name 'images'
const upload = multer({ storage });

// Compression route: Handles POST requests to /compress
// This route processes images in parallel and returns JSON results including output filenames.
app.post("/compress", upload.array("images"), async (req, res) => {
  // Clear previous processed images data for this simple implementation
  // This makes the temporary storage only hold the results of the last batch.
  // This is fine for a single user, but problematic with concurrent users.
  // POTENTIAL BOTTLENECK 2: Clearing the entire storage on *each* new request
  // means only the last batch processed is available for download. Concurrent
  // users will overwrite each other's results.
  for (const key in processedImages) {
      delete processedImages[key];
  }

  // Get format and quality from query parameters
  const format = req.query.format; // Expected: 'jpeg', 'png', 'webp', 'avif', 'jxl'
  const quality = parseInt(req.query.quality, 10) || 75; // Default quality to 75

  console.log(`Received ${req.files.length} files for conversion to ${format} with quality ${quality}. Starting parallel processing...`); // Log received request details

  // Process each file asynchronously using Promise.all for parallel execution.
  // This significantly speeds up processing for multiple files compared to sequential processing.
  // This is a good approach for parallelizing within a single request.
  const processingPromises = req.files.map(async (file) => {
    const originalname = file.originalname;
    const originalSize = file.size; // Original size in bytes
    const name = path.parse(originalname).name;
    // Determine the output filename based on the original name and requested format
    const outputFilename = `${name}.${format}`;
    let status = "Error"; // Default status in case of any issue
    let compressedSize = 0; // Default compressed size
    let errorMessage = null; // To store specific error message for the frontend

    try {
      console.log(`Processing file: ${originalname}`); // Log which file is being processed

      // Create a sharp instance from the file buffer.
      // Sharp uses the highly performant libvips library internally.
      let converted = sharp(file.buffer);

      // Check if the requested format is supported by Sharp and apply conversion
      // Note: JXL support in Sharp might require specific build configurations.
      const supportedFormats = ["jpeg", "png", "webp", "avif", "jxl"];
      if (supportedFormats.includes(format)) {
        // Apply the selected format and quality.
        // The 'quality' option controls the compression level for lossy formats.
        // Sharp is generally fast, but processing large images or complex operations
        // can still take time depending on server resources.
        converted = converted.toFormat(format, { quality });
      } else {
        console.warn(`Unsupported format requested for ${originalname}: ${format}. Skipping.`);
        status = "Unsupported Format";
        errorMessage = `Unsupported format: ${format}`;
      }

      // Only attempt to convert and store if the format was supported and no initial error
      if (status !== "Unsupported Format") {
          const buffer = await converted.toBuffer(); // Perform the conversion and get the output buffer
          compressedSize = buffer.length; // Get the size of the compressed buffer
          status = "Complete"; // Set status to Complete on success

          // Store the processed buffer temporarily using the output filename as the key
          // POTENTIAL BOTTLENECK 3: Storing large buffers in memory can be resource-intensive.
          // For larger scale, consider writing to a temporary file or streaming directly.
          processedImages[outputFilename] = buffer;

          console.log(`Successfully processed: ${originalname} -> ${outputFilename}. Original size: ${originalSize} bytes, Compressed size: ${compressedSize} bytes.`);
      }

    } catch (err) {
      // Catch any errors that occur during the sharp processing for this specific file
      console.error(`Error processing ${originalname}:`, err.message);
      if (err.stack) {
          console.error(err.stack); // Log stack trace for debugging
      }
      status = "Error"; // Set status to Error
      errorMessage = err.message; // Store the error message
    }

    // Return a result object for this file, including the outputFilename
    return {
        name: originalname, // Keep original name for frontend display
        outputFilename: outputFilename, // Include the calculated output filename
        originalSize: originalSize,
        compressedSize: compressedSize,
        status: status,
        errorMessage: errorMessage // Include error message in the result
    };
  });

  // Wait for all processing promises to settle (either resolve or reject)
  // Promise.all ensures that we wait for all individual file processing tasks to complete.
  const results = await Promise.all(processingPromises);

  console.log(`Finished parallel processing. Sending results for ${results.length} files.`);

  // Send the processing results as a JSON response back to the frontend
  res.json(results);

  // NOTE: The processedImages object now holds the buffers of the successfully
  // converted images, keyed by their output filename.
  // The /download/:filename and /download-all-zip routes use this storage.
});

// Route to download individual processed images
app.get("/download/:filename", (req, res) => {
    const filename = req.params.filename; // This is the output filename requested by the frontend
    const imageBuffer = processedImages[filename]; // Retrieve the buffer using the output filename

    if (imageBuffer) {
        // Determine Content-Type based on file extension for correct download
        const ext = path.extname(filename).toLowerCase();
        let contentType = 'application/octet-stream'; // Default to a generic type
        if (ext === '.jpeg' || ext === '.jpg') contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.webp') contentType = 'image/webp';
        else if (ext === '.avif') contentType = 'image/avif';
        else if (ext === '.jxl') contentType = 'image/jxl'; // Note: JXL support might vary

        // Set headers for file download
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(imageBuffer); // Send the image buffer as the response body
        console.log(`Serving file for download: ${filename}`);
    } else {
        console.warn(`File not found for download: ${filename}`);
        res.status(404).send("File not found."); // Send a 404 response if the file is not in temporary storage
    }
});

// Route to download all processed images as a zip file
app.get("/download-all-zip", (req, res) => {
    // Create a new zip archive
    const archive = archiver('zip', {
        zlib: { level: 6 } // Set compression level (optional)
    });

    // Set response headers for a zip file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="compressed_images.zip"');

    // Pipe the archive output directly to the response stream
    archive.pipe(res);

    // Add files from the processedImages temporary storage to the archive
    const filenames = Object.keys(processedImages);
    if (filenames.length === 0) {
        console.warn("No processed images available for zipping.");
        // If no files, finalize an empty archive and exit
        archive.finalize();
        return;
    }

    filenames.forEach(filename => {
        const buffer = processedImages[filename];
        // Append the buffer to the archive with the correct filename
        archive.append(buffer, { name: filename });
        console.log(`Adding ${filename} to zip archive.`);
    });

    // Finalize the archive - this triggers the piping to the response
    archive.finalize();
    console.log("Zip archive finalized and sent.");

    // NOTE: In a production app, you might want to clear processedImages
    // after the zip is successfully sent, or use a more robust temporary storage
    // that handles cleanup based on sessions or timestamps.
});


// Start the Express server and listen on the specified port
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
