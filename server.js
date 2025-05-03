import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import sharp from "sharp";
import archiver from "archiver"; // Import archiver for zip creation
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Temporary storage for processed image buffers
// In a production environment, consider more robust storage (e.g., disk, cloud storage)
const processedImages = {}; // Object to store { filename: buffer } pairs

// Middleware to serve static files (like your index.html and logo.png)
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
// This route will now process images in parallel and return JSON results.
app.post("/compress", upload.array("images"), async (req, res) => {
  // Clear previous processed images data
  // NOTE: This simple clearing means only the last batch of processed images is available for download.
  // For multiple user sessions, you'd need a more sophisticated storage strategy (e.g., using session IDs or temporary directories).
  for (const key in processedImages) {
      delete processedImages[key];
  }

  // Get format and quality from query parameters
  const format = req.query.format; // Expected: 'jpeg', 'png', 'webp', 'avif', 'jxl'
  const quality = parseInt(req.query.quality, 10) || 75; // Default quality to 75

  // Check if files were uploaded
  if (!req.files || req.files.length === 0) {
    console.warn("No images uploaded."); // Log this on the server too
    return res.status(400).json({ error: "No images uploaded." }); // Send JSON error
  }

  console.log(`Received ${req.files.length} files for conversion to ${format} with quality ${quality}. Starting parallel processing...`); // Log received request details

  const processingPromises = req.files.map(async (file) => {
    const originalname = file.originalname;
    const originalSize = file.size; // Original size in bytes
    const name = path.parse(originalname).name;
    const filename = `${name}.${format}`; // Output filename
    let status = "Error"; // Default status
    let compressedSize = 0; // Default compressed size
    let errorMessage = null; // To store specific error message

    try {
      console.log(`Processing file: ${originalname}`); // Log which file is being processed

      // Create a sharp instance from the file buffer
      let converted = sharp(file.buffer);

      // Check if the requested format is supported by Sharp and apply conversion
      const supportedFormats = ["jpeg", "png", "webp", "avif", "jxl"];
      if (supportedFormats.includes(format)) {
        converted = converted.toFormat(format, { quality });
      } else {
        console.warn(`Unsupported format requested for ${originalname}: ${format}. Skipping.`);
        status = "Unsupported Format";
        errorMessage = `Unsupported format: ${format}`;
      }

      // Only attempt to convert and store if format was supported
      if (status !== "Unsupported Format") {
          const buffer = await converted.toBuffer();
          compressedSize = buffer.length; // Compressed size in bytes
          status = "Complete";

          // Store the processed buffer temporarily
          processedImages[filename] = buffer;

          console.log(`Successfully processed: ${originalname} -> ${filename}. Original size: ${originalSize} bytes, Compressed size: ${compressedSize} bytes.`);
      }

    } catch (err) {
      // Catch errors during sharp processing for a specific file
      console.error(`Error processing ${originalname}:`, err.message);
      if (err.stack) {
          console.error(err.stack);
      }
      status = "Error";
      errorMessage = err.message;
    }

    // Return result for this file
    return {
        name: originalname,
        originalSize: originalSize,
        compressedSize: compressedSize,
        status: status,
        errorMessage: errorMessage // Include error message in the result
    };
  });

  // Wait for all processing promises to settle (either resolve or reject)
  const results = await Promise.all(processingPromises);

  console.log(`Finished parallel processing. Sending results for ${results.length} files.`);

  // Send the processing results as a JSON response
  res.json(results);

  // NOTE: The processedImages object now holds the buffers of the successfully
  // converted images. The /download/:filename route uses this storage.
  // The "Download All" zip functionality is implemented in the new /download-all-zip route below.
});

// Route to download individual processed images
app.get("/download/:filename", (req, res) => {
    const filename = req.params.filename;
    const imageBuffer = processedImages[filename];

    if (imageBuffer) {
        // Determine Content-Type based on file extension
        const ext = path.extname(filename).toLowerCase();
        let contentType = 'application/octet-stream'; // Default
        if (ext === '.jpeg' || ext === '.jpg') contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.webp') contentType = 'image/webp';
        else if (ext === '.avif') contentType = 'image/avif';
        else if (ext === '.jxl') contentType = 'image/jxl'; // Note: JXL support might vary

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(imageBuffer); // Send the image buffer
        console.log(`Serving file for download: ${filename}`);
    } else {
        console.warn(`File not found for download: ${filename}`);
        res.status(404).send("File not found.");
    }
});

// New route to download all processed images as a zip file
app.get("/download-all-zip", (req, res) => {
    const archive = archiver('zip', {
        zlib: { level: 6 } // Compression level
    });

    // Set response headers for a zip file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="compressed_images.zip"');

    // Pipe the archive output to the response
    archive.pipe(res);

    // Add files from the processedImages temporary storage to the archive
    const filenames = Object.keys(processedImages);
    if (filenames.length === 0) {
        console.warn("No processed images available for zipping.");
        // Send an empty zip or an error, depending on desired behavior
        archive.finalize(); // Finalize an empty archive
        return; // Exit the function
    }

    filenames.forEach(filename => {
        const buffer = processedImages[filename];
        archive.append(buffer, { name: filename });
        console.log(`Adding ${filename} to zip archive.`);
    });

    // Finalize the archive
    archive.finalize();
    console.log("Zip archive finalized and sent.");

    // NOTE: In a production app, you might want to clear processedImages
    // after the zip is successfully sent, or use a more robust temporary storage
    // that handles cleanup.
});


// Start the Express server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
