import express from "express";
import fs from "fs/promises"; // Use fs.promises for async file operations
import path from "path";
import multer from "multer";
import sharp from "sharp"; // Sharp is a high-performance image processing library
import archiver from "archiver"; // Import archiver for zip creation
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique filenames

// Helper to get __filename and __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- Temporary File Storage Setup ---
const tempUploadDir = path.join(__dirname, 'temp', 'uploads');
const tempProcessedDir = path.join(__dirname, 'temp', 'processed');

// Ensure temporary directories exist
async function createTempDirs() {
    try {
        await fs.mkdir(tempUploadDir, { recursive: true });
        await fs.mkdir(tempProcessedDir, { recursive: true });
        console.log("Temporary directories created or already exist.");
    } catch (error) {
        console.error("Error creating temporary directories:", error);
        // Depending on severity, you might want to exit the process here
    }
}

createTempDirs(); // Create directories on server start

// Temporary storage for processed image file paths
// This now stores paths to files on disk, significantly reducing memory usage.
// In a production environment, consider linking this to user sessions for
// proper isolation and cleanup.
const processedImages = {}; // Object to store { outputFilename: tempFilePath } pairs

// Middleware to serve static files (like your index.html, logo.png, sitemap.xml, robots.txt)
app.use(express.static(__dirname));

// Serve main HTML file when accessing the root URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Multer setup: Use diskStorage to save files to a temporary directory
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Save original uploaded files to the tempUploadDir
        cb(null, tempUploadDir);
    },
    filename: function (req, file, cb) {
        // Use a unique filename to avoid collisions
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
    }
});

// Configure multer to accept an array of files with the field name 'images'
const upload = multer({ storage });

// Compression route: Handles POST requests to /compress
// This route processes images from disk and saves results to temporary files.
app.post("/compress", upload.array("images"), async (req, res) => {
  // Clear previous processed images data for this simple implementation
  // NOTE: This still clears data from previous requests. For concurrent users,
  // you need a session-based approach to manage temporary files.
  for (const key in processedImages) {
       // In a real application, you would also delete the actual temporary file here
       // if it wasn't already downloaded/cleaned up.
       delete processedImages[key];
  }

  // Check if files were actually uploaded by Multer
  if (!req.files || req.files.length === 0) {
      console.warn("No files received in /compress request.");
      return res.status(400).json({ error: "No files uploaded." });
  }

  // Get format and quality from query parameters
  const format = req.query.format; // Expected: 'jpeg', 'png', 'webp', 'avif', 'jxl'
  const quality = parseInt(req.query.quality, 10) || 75; // Default quality to 75

  console.log(`Received ${req.files.length} files for conversion to ${format} with quality ${quality}. Starting parallel processing...`);

  // Process each file asynchronously using Promise.all for parallel execution.
  const processingPromises = req.files.map(async (file) => {
    const originalname = file.originalname;
    const originalSize = file.size; // Original size in bytes (from Multer)
    const name = path.parse(originalname).name;
    // Determine the output filename based on the original name and requested format
    const outputFilename = `${name}.${format}`;
    let status = "Error"; // Default status in case of any issue
    let compressedSize = 0; // Default compressed size
    let errorMessage = null; // To store specific error message for the frontend
    let tempProcessedFilePath = null; // To store the path of the processed temp file

    try {
      console.log(`Processing file: ${originalname} from temp path: ${file.path}`);

      // Create a sharp instance from the file path (Sharp can read directly from file)
      let converted = sharp(file.path);

      // Check if the requested format is supported by Sharp and apply conversion
      const supportedFormats = ["jpeg", "png", "webp", "avif", "jxl"];
      const sharpFormat = format.toLowerCase();
      if (supportedFormats.includes(sharpFormat)) {
        converted = converted.toFormat(sharpFormat, { quality });
      } else {
        console.warn(`Unsupported format requested for ${originalname}: ${format}. Skipping.`);
        status = "Unsupported Format";
        errorMessage = `Unsupported format: ${format}`;
      }

      // Only attempt to convert and save if the format was supported and no initial error
      if (status !== "Unsupported Format") {
          // Generate a unique filename for the processed file
          const processedFileName = `${uuidv4()}.${sharpFormat}`;
          tempProcessedFilePath = path.join(tempProcessedDir, processedFileName);

          // Perform the conversion and write the output directly to a temporary file
          const info = await converted.toFile(tempProcessedFilePath);
          compressedSize = info.size; // Get the size of the processed file
          status = "Complete"; // Set status to Complete on success

          // Store the path to the processed file temporarily
          processedImages[outputFilename] = tempProcessedFilePath;

          console.log(`Successfully processed: ${originalname} -> ${outputFilename}. Saved to temp path: ${tempProcessedFilePath}. Original size: ${originalSize} bytes, Compressed size: ${compressedSize} bytes.`);
      }

    } catch (err) {
      // Catch any errors that occur during the sharp processing for this specific file
      console.error(`Error processing ${originalname}:`, err.message);
      if (err.stack) {
          console.error(err.stack); // Log stack trace for debugging
      }
      status = "Error"; // Set status to Error
      errorMessage = err.message; // Store the error message
    } finally {
        // --- Cleanup: Delete the original uploaded temporary file ---
        try {
            await fs.unlink(file.path);
            console.log(`Deleted temporary uploaded file: ${file.path}`);
        } catch (cleanupError) {
            console.error(`Error deleting temporary uploaded file ${file.path}:`, cleanupError);
        }
    }

    // Return a result object for this file, including the outputFilename and temp path
    return {
        name: originalname, // Keep original name for frontend display
        outputFilename: outputFilename, // Include the calculated output filename
        originalSize: originalSize,
        compressedSize: compressedSize,
        status: status,
        errorMessage: errorMessage, // Include error message in the result
        tempProcessedFilePath: tempProcessedFilePath // Include the temp file path for download
    };
  });

  // Wait for all processing promises to settle (either resolve or reject)
  const results = await Promise.all(processingPromises);

  console.log(`Finished parallel processing. Sending results for ${results.length} files.`);

  // Send the processing results as a JSON response back to the frontend
  res.json(results);

  // NOTE: The processedImages object now holds the paths to the successfully
  // converted images. The /download/:filename and /download-all-zip routes
  // will read from these paths.
});

// Route to download individual processed images
app.get("/download/:filename", async (req, res) => {
    const filename = req.params.filename; // This is the output filename requested by the frontend
    const tempFilePath = processedImages[filename]; // Retrieve the temp file path

    if (tempFilePath) {
        try {
            // Determine Content-Type based on file extension for correct download
            const ext = path.extname(filename).toLowerCase();
            let contentType = 'application/octet-stream'; // Default to a generic type
            // It's better to use a more comprehensive list or a library for MIME types
            if (ext === '.jpeg' || ext === '.jpg') contentType = 'image/jpeg';
            else if (ext === '.png') contentType = 'image/png';
            else if (ext === '.webp') contentType = 'image/webp';
            else if (ext === '.avif') contentType = 'image/avif';
            else if (ext === '.jxl') contentType = 'image/jxl'; // Note: JXL support might vary

            // Set headers for file download
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            // Stream the file from the temporary path to the response
            const fileStream = fs.createReadStream(tempFilePath);
            fileStream.pipe(res);

            console.log(`Serving file for download: ${filename} from ${tempFilePath}`);

            // --- Cleanup: Delete the temporary file after it's sent ---
            // This is a basic cleanup. For production, consider more robust
            // strategies (e.g., delete after successful stream completion).
            fileStream.on('end', async () => {
                try {
                    await fs.unlink(tempFilePath);
                    console.log(`Deleted temporary processed file: ${tempFilePath}`);
                    // Also remove from processedImages after successful download
                    delete processedImages[filename];
                } catch (cleanupError) {
                    console.error(`Error deleting temporary processed file ${tempFilePath}:`, cleanupError);
                }
            });

            fileStream.on('error', (streamError) => {
                console.error(`Error streaming temporary file ${tempFilePath}:`, streamError);
                // Handle stream errors, potentially sending an error response
                if (!res.headersSent) {
                    res.status(500).send("Error streaming file.");
                }
            });

        } catch (readError) {
            console.error(`Error reading temporary file ${tempFilePath}:`, readError);
            res.status(500).send("Error reading file.");
        }

    } else {
        console.warn(`File not found for download: ${filename}. Path not in processedImages.`);
        res.status(404).send("File not found.");
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
        archive.finalize(); // Finalize an empty archive
        return;
    }

    // Add files to the archive using their temporary file paths
    filenames.forEach(filename => {
        const tempFilePath = processedImages[filename];
         if (tempFilePath) {
             // Append the file from the temporary path to the archive
             archive.file(tempFilePath, { name: filename });
             console.log(`Adding ${filename} (from ${tempFilePath}) to zip archive.`);
         } else {
             console.warn(`Temporary file path not found for ${filename}. Skipping.`);
         }
    });

    // Finalize the archive - this triggers the piping to the response
    archive.finalize();
    console.log("Zip archive finalized and sent.");

    // --- Cleanup: Considerations for Zip Download Cleanup ---
    // Cleaning up temporary files immediately after archive.finalize() might be
    // too soon if the piping is still in progress for large zip files.
    // A more robust cleanup would involve:
    // 1. Listening for the 'close' or 'end' event on the response stream.
    // 2. Implementing a scheduled task that periodically cleans up old temporary files
    //    based on their creation or last access time.
    // For this example, the files will remain in the temp directory until a
    // subsequent /compress request clears the processedImages object or a manual
    // cleanup is performed. Implementing a proper scheduled cleanup is recommended
    // for production.
});


// Start the Express server and listen on the specified port
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});

// --- Basic Cleanup on Server Shutdown (Optional but Recommended) ---
// This attempts to clean up temp files when the server process is stopped gracefully.
// It might not catch all cases (e.g., sudden crashes).
process.on('SIGINT', async () => {
    console.log('Server shutting down. Attempting to clean up temporary files...');
    try {
        await fs.rm(path.join(__dirname, 'temp'), { recursive: true, force: true });
        console.log('Temporary directory removed.');
    } catch (error) {
        console.error('Error during temporary directory cleanup:', error);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Server shutting down. Attempting to clean up temporary files...');
    try {
        await fs.rm(path.join(__dirname, 'temp'), { recursive: true, force: true });
        console.log('Temporary directory removed.');
    } catch (error) {
        console.error('Error during temporary directory cleanup:', error);
    }
    process.exit(0);
});
