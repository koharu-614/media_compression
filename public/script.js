import fs from "fs";
import path from "path";
import sharp from "sharp";
import archiver from "archiver";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { filePath, rows, cols } = req.body;
    const image = sharp(filePath);
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;

    const baseName = path.basename(filePath, path.extname(filePath));
    const zipPath = `/tmp/${baseName}_split.zip`;
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);

    const tileWidth = Math.floor(width / cols);
    const tileHeight = Math.floor(height / rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const left = c * tileWidth;
        const top = r * tileHeight;
        const outputPath = `/tmp/${baseName}_${r}_${c}.png`;

        await image
          .extract({ left, top, width: tileWidth, height: tileHeight })
          .toFile(outputPath);

        archive.file(outputPath, { name: path.basename(outputPath) });
      }
    }

    await archive.finalize();

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${baseName}_split.zip`);
    fs.createReadStream(zipPath).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
