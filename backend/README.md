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
