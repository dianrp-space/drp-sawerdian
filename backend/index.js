import express from "express";
import bodyParser from "body-parser";
import QRCode from "qrcode";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { decodeQRFromImage } from "./qris-image.js";
import { calculateCRC } from "./qris-crc.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
const upload = multer();

// Helper: parse static QRIS, inject nominal, return dynamic QRIS (dengan CRC)
function generateDynamicQRIS(staticQris, amount, fee = 0) {
  // 1. Ubah tag 01 (setelah tag 00) ke 12, header QRIS tetap utuh
  let qris = staticQris;
  // Cari tag 00 (biasanya di awal)
  if (qris.startsWith("000201")) {
    // Tag 00 (6 char), tag 01 (4 char: 2 tag, 2 length), value 2 char
    qris = qris.slice(0, 6) + "010212" + qris.slice(12);
  } else {
    // fallback: regex ganti tag 01 length 02 ke 12
    qris = qris.replace(/01(02)11/, "010212");
  }

  // 2. Hapus CRC lama jika ada
  qris = qris.replace(/6304[0-9A-Fa-f]{4}$/, "");

  // 3. Parse QRIS menjadi array tag
  function parseTags(str) {
    let tags = [];
    let i = 0;
    while (i < str.length) {
      let tag = str.substr(i, 2);
      let len = parseInt(str.substr(i + 2, 2), 10);
      let val = str.substr(i + 4, len);
      tags.push({ tag, len, val });
      i += 4 + len;
    }
    return tags;
  }

  let tags = parseTags(qris);
  // 4. Hapus tag 54 jika ada
  tags = tags.filter((t) => t.tag !== "54");

  // 5. Sisipkan tag 54 setelah tag 53
  let nominal = String(Number(amount) + Number(fee));
  let nominalTag = { tag: "54", len: nominal.length, val: nominal };
  let idx53 = tags.findIndex((t) => t.tag === "53");
  if (idx53 !== -1) {
    tags.splice(idx53 + 1, 0, nominalTag);
  } else {
    // fallback: setelah tag 52
    let idx52 = tags.findIndex((t) => t.tag === "52");
    if (idx52 !== -1) {
      tags.splice(idx52 + 1, 0, nominalTag);
    } else {
      tags.push(nominalTag);
    }
  }

  // 6. Gabungkan kembali QRIS
  let qrisWithAmount =
    tags
      .map((t) => t.tag + t.len.toString().padStart(2, "0") + t.val)
      .join("") + "6304";

  // 7. Hitung CRC dari awal hingga sebelum nilai CRC
  let crc = calculateCRC(qrisWithAmount);
  let dynamic = qrisWithAmount + crc;
  return dynamic;
}

app.post("/api/generate", async (req, res) => {
  const { staticQris, amount, fee } = req.body;
  if (!staticQris || !amount)
    return res.status(400).json({ error: "Missing data" });
  const dynamicQris = generateDynamicQRIS(staticQris, amount, fee || 0);
  const qrImage = await QRCode.toDataURL(dynamicQris);
  res.json({ dynamicQris, qrImage });
});

// Endpoint: cek kesehatan server
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Endpoint: upload gambar QR, decode QRIS
app.post("/api/parse-image", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const qris = await decodeQRFromImage(req.file.buffer);
    res.json({ qris });
  } catch (e) {
    console.error("Error decoding QR:", e);
    res.status(500).json({ error: "Failed to decode QR" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`QRIS backend running on port ${PORT}`));
