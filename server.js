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
      fs.unlinkSync(inputPath);  // Clean up uploaded files
    }

    // Create a ZIP file of all converted images
    const zipFilename = `converted_${timestamp}.zip`;
    const zipPath = path.join(zipDir, zipFilename);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(sessionDir, false);
    await archive.finalize();

    // Generate the HTML for the download section
    let html = `
      <h2>Converted ${convertedFiles.length} files</h2>
    `;

    convertedFiles.forEach(file => {
      html += `<p><a href="${file.path}" download>Download ${file.filename}</a></p>`;
    });

    html += `
      <hr>
      <a href="/zips/${zipFilename}" download>Download All as ZIP</a>
      <br><br><a href="/">Back to Converter</a>
    `;

    // Send the response with the download links
    res.send(html);
  } catch (err) {
    console.error('Conversion error:', err);
    res.status(500).send('An error occurred during image conversion.');
  }
});
