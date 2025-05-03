import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import sharp from "sharp";
import archiver from "archiver";
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
// 'upload.array("images")' middleware processes the uploaded files before the handler
app.post("/compress", upload.array("images"), async (req, res) => {
  // Get format and quality from query parameters
  const format = req.query.format; // Expected: 'jpeg', 'png', 'webp', 'avif', 'jxl'
  const quality = parseInt(req.query.quality, 10) || 75; // Default quality to 75

  // Check if files were uploaded
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No images uploaded.");
  }

  // Set response headers for a zip file download
  res.setHeader("Content-Type", "application/zip");
  // 'attachment' prompts download, 'filename' suggests the file name
  res.setHeader("Content-Disposition", "attachment; filename=compressed_images.zip");

  // Create a zip archiver instance
  const archive = archiver("zip", {
    zlib: { level: 9 } // Set compression level
  });

  // Pipe the archive output directly to the response stream
  archive.pipe(res);

  // Add error handling for the archive stream
  archive.on('error', function(err){
      console.error('Archiving error:', err);
      // You might want to send an error response here, but it's tricky
      // after piping has started. Consider more robust error handling.
      // If headers haven't been sent, you could do res.status(500).send('Archive error');
  });

  // Process each uploaded file
  for (let file of req.files) {
    // Extract filename without extension
    const name = path.parse(file.originalname).name;
    // Create the output filename with the new format extension
    const filename = `${name}.${format}`;

    try {
      // Create a sharp instance from the file buffer
      let converted = sharp(file.buffer);

      // Check if the requested format is supported by Sharp and apply conversion
      // Note: Sharp's support for JXL might be experimental or require specific builds.
      if (["jpeg", "png", "webp", "avif", "jxl"].includes(format)) {
        // Apply format conversion and quality setting
        // Quality is mainly effective for lossy formats (jpeg, webp, avif, jxl)
        converted = converted.toFormat(format, { quality });
      } else {
        // If format is not supported, log a warning and skip this file
        console.warn(`Unsupported format requested for ${file.originalname}: ${format}. Skipping.`);
        continue; // Skip to the next file
      }

      // Convert the sharp instance back to a buffer
      const buffer = await converted.toBuffer();
      // Append the processed image buffer to the zip archive
      archive.append(buffer, { name: filename });

    } catch (err) {
      // Catch errors during sharp processing for a specific file
      console.error(`Error processing ${file.originalname}:`, err.message);
      // This file will be skipped in the zip. The archive will continue with other files.
    }
  }

  // Finalize the archive - signals the end of the archive and streams the footer
  // This should be called after all files have been appended.
  archive.finalize();
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
