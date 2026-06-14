# QRIS Dynamic Generator Backend

## Cara Menjalankan

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Jalankan server:
   ```bash
   npm start
   ```
3. Atau jalankan via PM2 (direkomendasikan untuk VPS/Server)


Server berjalan di port 3001 (http://localhost:3001)

---

# Penjelasan API

## 1. Health Check
- Endpoint: `GET /api/health`
- Response:
  - `status`: "OK"
  - `timestamp`: string ISO timestamp

## 2. Generate Dynamic QRIS
- Endpoint: `POST /api/generate`
- Body JSON:
  - `staticQris`: string QRIS statis
  - `amount`: nominal transaksi (angka)
  - `fee`: biaya layanan (opsional, angka)
- Response:
  - `dynamicQris`: string QRIS dinamis
  - `qrImage`: base64 PNG QR code

## 3. Parse QRIS dari Upload Gambar
- Endpoint: `POST /api/parse-image`
- Content-Type: `multipart/form-data`
- Body:
  - `file`: File gambar (JPG, PNG, dll)
- Response:
  - `qris`: string QRIS hasil scan

## 4. Parse QRIS dari URL Gambar
- Endpoint: `POST /api/parse-image-url`
- Body JSON:
  - `imageUrl`: string URL gambar QR
- Response:
  - `qris`: string QRIS hasil scan
