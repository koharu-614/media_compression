import formidable from "formidable";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import archiver from "archiver";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "POSTメソッドを使用してください" });
  }

  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

  const form = formidable({ uploadDir, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "ファイル解析中にエラーが発生しました" });
    }

    const file = files.file[0];
    const filePath = file.filepath;

    try {
      // 元のファイル名（拡張子なし）を取得
      const originalName = path.parse(file.originalFilename || file.newFilename || file.filepath).name;
      const metadata = await sharp(filePath).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error("画像のサイズを取得できませんでした");
      }

      const { width, height } = metadata;
      const MAX_SIZE = 400; // 最大サイズを400pxに設定

      const cols = Math.ceil(width / MAX_SIZE);
      const rows = Math.ceil(height / MAX_SIZE);

      const pieceWidth = Math.floor(width / cols);
      const pieceHeight = Math.floor(height / rows);

      if (pieceWidth <= 0 || pieceHeight <= 0) {
        throw new Error("画像が小さすぎて分割できません");
      }

      const outputFiles = [];
      const outputPaths = [];

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const left = Math.floor(x * pieceWidth);
          const top = Math.floor(y * pieceHeight);

          const widthPart = x === cols - 1 ? width - left : pieceWidth;
          const heightPart = y === rows - 1 ? height - top : pieceHeight;

          // ✅ 元画像名を使った分割ファイル名に変更
          const outputFileName = `${originalName}_${y}_${x}.png`;
          const outputPath = path.join(uploadDir, outputFileName);
          outputPaths.push(outputPath);

          await sharp(filePath)
            .extract({
              left: Math.max(0, left),
              top: Math.max(0, top),
              width: Math.max(1, Math.min(widthPart, width - left)),
              height: Math.max(1, Math.min(heightPart, height - top)),
            })
            .png()
            .toFile(outputPath);

          const base64 = fs.readFileSync(outputPath, { encoding: "base64" });
          outputFiles.push(`data:image/png;base64,${base64}`);
        }
      }

      // ✅ ZIPファイル名も元ファイル名に基づく
      const zipFileName = `${originalName}_圧縮.zip`;
      const zipPath = path.join(uploadDir, zipFileName);

      // ZIP作成
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", async () => {
        // 分割画像を削除
        for (const tempFile of outputPaths) {
          fs.unlinkSync(tempFile);
        }

        // ZIPをBase64で返す
        const zipBase64 = fs.readFileSync(zipPath, { encoding: "base64" });
        fs.unlinkSync(zipPath);

        res.status(200).json({
          message: "画像を分割してZIP化しました",
          parts: outputFiles,
          zipFile: `data:application/zip;base64,${zipBase64}`,
          zipName: zipFileName,
        });
      });

      archive.on("error", (err) => {
        throw err;
      });

      archive.pipe(output);
      for (const outputPath of outputPaths) {
        archive.file(outputPath, { name: path.basename(outputPath) });
      }

      await archive.finalize();
    } catch (error) {
      console.error(error);
      for (const tempFile of outputPaths || []) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }
      res.status(500).json({ error: "画像処理中にエラーが発生しました" });
    }
  });
}
