
const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');
const fs      = require('fs');
const path    = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true }));

app.post('/convert', upload.single('image'), async (req, res) => {
  const inputPath = req.file.path;
  const format = req.body.format;
  const outputPath = `${inputPath}.${format}`;

  try {
    await sharp(inputPath)
      .toFormat(format)
      .toFile(outputPath);

    res.download(outputPath, `converted.${format}`, err => {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Conversion failed');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
