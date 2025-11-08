import formidable from "formidable";
import fs from "fs";
import path from "path";
import os from "os";
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

  // サーバー環境ではプロジェクトフォルダへの書き込みが制限されることがあるため
  // OSの一時ディレクトリを使う
  const uploadDir = path.join(os.tmpdir(), "media_compression_uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const form = formidable({ uploadDir, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "ファイル解析中にエラーが発生しました" });
    }

    // formidable の出力は環境やバージョンで形が変わるため柔軟に対応
    let uploadedFile = null;
    if (Array.isArray(files.file)) uploadedFile = files.file[0];
    else if (files.file) uploadedFile = files.file;
    else {
      // どのキーにファイルが入っているか探索
      for (const k of Object.keys(files)) {
        const v = files[k];
        if (Array.isArray(v) && v.length > 0) {
          uploadedFile = v[0];
          break;
        } else if (v && (v.filepath || v.path)) {
          uploadedFile = v;
          break;
        }
      }
    }

    if (!uploadedFile) {
      return res.status(400).json({ error: "アップロードされたファイルが見つかりません" });
    }

    const file = uploadedFile;
    const filePath = file.filepath || file.filePath || file.path;

    try {
  // 元のファイル名（拡張子なし）を取得
  const originalName = path.parse(file.originalFilename || file.originalname || file.newFilename || file.name || file.filepath || filePath || "split_images").name;

  // ファイルパスから直接読み込めない可能性があるため、一旦バッファで読み込む
  const inputBuffer = await fs.promises.readFile(filePath);
  const metadata = await sharp(inputBuffer).metadata();
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

          await sharp(inputBuffer)
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
          try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) { console.warn('failed to remove temp', tempFile, e); }
        }

        // アップロード元ファイルを削除（存在する場合）
        try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.warn('failed to remove uploaded file', filePath, e); }

        // ZIPをBase64で返す
        const zipBase64 = fs.readFileSync(zipPath, { encoding: "base64" });
        try { fs.unlinkSync(zipPath); } catch (e) { console.warn('failed to remove zip', zipPath, e); }

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
