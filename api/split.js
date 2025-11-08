import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false, // formidableを使うのでデフォルト無効化
  },
};

export default async function handler(req, res) {
  if (req.method === "POST") {
    const form = formidable({ multiples: false });
    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "ファイル解析中にエラーが発生しました" });
        return;
      }
      console.log("アップロードされたファイル:", files);
      res.status(200).json({ message: "ファイルを受け取りました", files });
    });
  } else {
    res.status(405).json({ message: "POSTメソッドを使用してください" });
  }
}
