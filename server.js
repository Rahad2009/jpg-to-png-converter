const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const app = express();
const PORT = 3000;

const upload = multer({ dest: 'uploads/' });
const convertedDir = path.join(__dirname, 'converted');

// Middleware to serve static files
app.use(express.static('public'));
app.use('/converted', express.static('converted'));
app.use('/zips', express.static('zips'));

// Ensure output folders exist
if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir);
if (!fs.existsSync('zips')) fs.mkdirSync('zips');

// HTML form handler
app.post('/convert', upload.array('images'), async (req, res) => {
  const format = req.body.format || 'png';
  const files = req.files;
  const convertedFiles = [];

  const timestamp = Date.now();
  const sessionDir = path.join(convertedDir, String(timestamp));
  fs.mkdirSync(sessionDir);

  try {
    for (const file of files) {
      const inputPath = file.path;
      const ext = format === 'jpeg' ? 'jpg' : format;
      const outputFilename = `${path.parse(file.originalname).name}_${Date.now()}.${ext}`;
      const outputPath = path.join(sessionDir, outputFilename);

      await sharp(inputPath)
        .toFormat(format)
        .toFile(outputPath);

      convertedFiles.push({ filename: outputFilename, path: `/converted/${timestamp}/${outputFilename}` });

      fs.unlinkSync(inputPath); // Remove temp uploaded file
    }

    // ZIP creation
    const zipFilename = `converted_${timestamp}.zip`;
    const zipPath = path.join(__dirname, 'zips', zipFilename);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(sessionDir, false);
    await archive.finalize();

    // HTML response with download links
    let html = `<h2>Converted ${convertedFiles.length} files</h2>`;
    convertedFiles.forEach(file => {
      html += `<p><a href="${file.path}" download>Download ${file.filename}</a></p>`;
    });
    html += `<hr><a href="/zips/${zipFilename}" download>Download All as ZIP</a>`;
    html += `<br><br><a href="/">Back to Converter</a>`;

    res.send(html);

  } catch (err) {
    console.error('Conversion error:', err);
    res.status(500).send('An error occurred during image conversion.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

