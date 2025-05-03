import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import sharp from "sharp";
// Removed archiver as this route will return JSON, not a zip directly
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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
// This route will now process images and return JSON results, NOT a zip file directly.
app.post("/compress", upload.array("images"), async (req, res) => {
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
  const processedFilesData = []; // Array to store processed file buffers and names for potential zipping later

  // Process each uploaded file
  for (let file of req.files) {
    const originalname = file.originalname;
    const originalSize = file.size; // Original size in bytes
    const name = path.parse(originalname).name;
    const filename = `${name}.${format}`; // Output filename
    let status = "Error"; // Default status
    let compressedSize = 0; // Default compressed size

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
      const buffer = await converted.toBuffer();
      compressedSize = buffer.length; // Compressed size in bytes
      status = "Complete";
      processedFilesData.push({ name: filename, buffer: buffer }); // Store processed data

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

  // NOTE: The processedFilesData array now holds the buffers of the successfully
  // converted images. You would need a separate route or mechanism to allow the
  // user to download these as a zip file after they see the results.
  // This requires further backend and frontend development.
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
