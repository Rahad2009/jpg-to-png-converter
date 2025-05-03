import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import sharp from "sharp";
import { fileURLToPath } from "url";
// No longer need archiver for the /compress route, but might need it for a separate /download-zip route later

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
// This route processes images and returns JSON results.
app.post("/compress", upload.array("images"), async (req, res) => {
  // Clear previous processed images data
  // NOTE: This simple clearing means only the last batch of processed images is available for download.
  // For multiple user sessions, you'd need a more sophisticated storage strategy.
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

  console.log(`Received ${req.files.length} files for conversion to ${format} with quality ${quality}`); // Log received request details

  const results = []; // Array to store processing results for each file

  // Process each uploaded file
  for (let file of req.files) {
    const originalname = file.originalname;
    const originalSize = file.size; // Original size in bytes
    const name = path.parse(originalname).name;
    const filename = `${name}.${format}`; // Output filename
    let status = "Error"; // Default status
    let compressedSize = 0; // Default compressed size
    let processedBuffer = null; // To store the sharp output buffer

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
        results.push({ name: originalname, originalSize, compressedSize, status });
        continue; // Skip to the next file
      }

      // Convert the sharp instance back to a buffer
      processedBuffer = await converted.toBuffer();
      compressedSize = processedBuffer.length; // Compressed size in bytes
      status = "Complete";

      // Store the processed buffer temporarily
      processedImages[filename] = processedBuffer;

      console.log(`Successfully processed: ${originalname} -> ${filename}. Original size: ${originalSize} bytes, Compressed size: ${compressedSize} bytes.`);

    } catch (err) {
      // Catch errors during sharp processing for a specific file
      console.error(`Error processing ${originalname}:`, err.message);
      if (err.stack) {
          console.error(err.stack);
      }
      status = "Error";
    }

    // Add result for this file to the results array
    results.push({ name: originalname, originalSize, compressedSize, status });
  }

  console.log(`Finished processing files. Sending results for ${results.length} files.`);

  // Send the processing results as a JSON response
  res.json(results);
});

// New route to download individual processed images
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


// Start the Express server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
