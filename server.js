const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static(__dirname));

app.post('/convert', upload.single('image'), async (req, res) => {
  const jpgPath = req.file.path;
  const pngPath = jpgPath + '.png';

  try {
    await sharp(jpgPath)
      .png()
      .toFile(pngPath);

    res.download(pngPath, 'converted.png', () => {
      fs.unlinkSync(jpgPath);
      fs.unlinkSync(pngPath);
    });
  } catch (err) {
    res.status(500).send('Conversion failed');
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
