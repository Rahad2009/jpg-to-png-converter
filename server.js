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

// Middleware to serve static files (like index.html)
app.use(express.static(__dirname));

// Serve the main HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Multer setup for file uploads (in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Compression route
app.post("/compress", upload.array("images"), async (req, res) => {
  const format = req.query.format; // e.g. 'jpeg', 'png', 'webp'
  const quality = parseInt(req.query.quality, 10) || 75;

  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No images uploaded.");
  }

  // Create zip archive
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", "attachment; filename=compressed_images.zip");

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const name = path.parse(file.originalname).name;
    const filename = `${name}.${format}`;

    try {
      const buffer = await sharp(file.buffer)
        .toFormat(format, { quality })
        .toBuffer();

      archive.append(buffer, { name: filename });
    } catch (err) {
      console.error(`Error processing ${file.originalname}:`, err.message);
    }
  }

  archive.finalize();
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
