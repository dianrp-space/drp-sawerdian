 # Sawerdian - Backend

Backend untuk website sawer dengan QRIS dinamis, leaderboard publik, dan dashboard admin.

## 🚀 Cara Menjalankan

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Setup `.env`
```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=3003
DATABASE_URL=postgresql://sawerdian:your_password@localhost:5432/sawerdian
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ganti_dengan_password_kuat
SESSION_SECRET=ganti_dengan_string_random_panjang_min_32_karakter
WEBHOOK_SECRET=ganti_dengan_string_random
QRIS_STATIC=00020101021126...   # (opsional)
BASE_URL=http://localhost:3003
```

### 3. Migrate database
```bash
npm run migrate
```

Akan create tables: `settings`, `donations`, `webhooks`, `webhook_logs`, `social_links`, `session` + seed default settings.

### 4. Jalankan server
```bash
npm start          # production
npm run dev        # development (auto-reload)
```

Default: http://localhost:3003

---

## 🔌 API Endpoints

### 🟢 PUBLIK (tanpa auth)

#### `GET /api/health`
Cek status server + database.
```bash
curl http://localhost:3003/api/health
```
Response:
```json
{
  "status": "OK",
  "timestamp": "2026-06-17T...",
  "database": "connected"
}
```

#### `GET /api/config`
Ambil konfigurasi publik (identitas, branding, preset nominal, socials).
```bash
curl http://localhost:3003/api/config
```
Response:
```json
{
  "creator": {
    "name": "Dian",
    "tagline": "Terima kasih sudah mendukung!",
    "website": "https://dianrp.com",
    "avatar": "/images/avatar.png",
    "banner": "",
    "primaryColor": "#6c5ce7"
  },
  "donation": {
    "presets": [5000, 10000, 20000, 50000, 100000],
    "minAmount": 2000,
    "maxAmount": 5000000,
    "customEnabled": true,
    "donorNameEnabled": true,
    "messageEnabled": true,
    "qrExpiryHours": 24
  },
  "socials": [...],
  "footer": "© 2026 DRP Network"
}
```

#### `POST /api/donations`
Buat donasi baru, return QR code + token.
```bash
curl -X POST http://localhost:3003/api/donations \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000,
    "donorName": "John Doe",
    "message": "Semangat terus!"
  }'
```
Response:
```json
{
  "ok": true,
  "donationId": 1,
  "qrToken": "abc123...",
  "amount": 10000,
  "amountFormatted": "Rp 10.000",
  "qrImage": "data:image/png;base64,...",
  "dynamicQris": "00020101021226...",
  "expiresAt": "2026-06-18T..."
}
```
*Rate limit: 10 request / 5 menit per IP*

#### `GET /api/donations/:token`
Cek status donasi by token.
```bash
curl http://localhost:3003/api/donations/abc123
```

#### `POST /api/donations/:token/paid` 🔐
**Auto-confirm dari Macrodroid**. Dilindungi `WEBHOOK_SECRET`.
```bash
curl -X POST "http://localhost:3003/api/donations/abc123/paid?secret=YOUR_WEBHOOK_SECRET"
```
Atau via header:
```bash
curl -X POST http://localhost:3003/api/donations/abc123/paid \
  -H "X-Webhook-Secret: YOUR_WEBHOOK_SECRET"
```
Response:
```json
{
  "ok": true,
  "message": "Donasi dikonfirmasi",
  "donation": { ... }
}
```

#### `GET /api/leaderboard`
Top sawer (nama di-mask).
```bash
curl "http://localhost:3003/api/leaderboard?period=month&limit=50"
```
Query params:
- `period`: `today` | `month` | `all` (default: `all`)
- `limit`: 1-200 (default: 50)

Response:
```json
{
  "period": "month",
  "count": 10,
  "items": [
    {
      "rank": 1,
      "amount": 50000,
      "amountFormatted": "Rp 50.000",
      "donorName": "A****m",   // masked
      "message": "Semangat!",
      "paidAt": "2026-06-17T..."
    }
  ]
}
```

#### `GET /api/leaderboard/stats`
Statistik ringkasan.
```bash
curl http://localhost:3003/api/leaderboard/stats
```

---

### 🔐 ADMIN (perlu session login)

#### `POST /api/admin/login`
```bash
curl -X POST http://localhost:3003/api/admin/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"username":"admin","password":"admin123"}'
```

#### `POST /api/admin/logout`

#### `GET /api/admin/me`
Cek session aktif.

#### `GET /api/admin/dashboard`
Statistik: total, hari ini, bulan ini, pending, 7 hari, top 5.

#### `GET /api/admin/settings` & `PUT /api/admin/settings`
Read & update semua settings.

#### `POST /api/admin/branding/:type` (type: `logo` | `banner`)
Upload logo/banner. `multipart/form-data` dengan field `file`.

#### `DELETE /api/admin/branding/:type`
Reset logo ke default / hapus banner.

#### `GET /api/admin/webhooks` & `POST /api/admin/webhooks`
List & tambah webhook.

#### `PUT /api/admin/webhooks/:id` & `DELETE /api/admin/webhooks/:id`
Edit & hapus webhook.

#### `POST /api/admin/webhooks/:id/test`
Test kirim payload dummy.

#### `GET /api/admin/webhook-logs`
Lihat log webhook (20 terakhir).

#### `GET /api/admin/socials` & `POST /api/admin/socials`
List & tambah social link.

#### `PUT /api/admin/socials/:id` & `DELETE /api/admin/socials/:id`
Edit & hapus social link.

#### `GET /api/admin/donations`
List donasi dengan filter & pagination.
```bash
curl -b cookies.txt "http://localhost:3003/api/admin/donations?status=pending&page=1&limit=20"
```

#### `GET /api/admin/donations/:id`

#### `PATCH /api/admin/donations/:id/status`
Update status manual.
```bash
curl -b cookies.txt -X PATCH http://localhost:3003/api/admin/donations/1/status \
  -H "Content-Type: application/json" \
  -d '{"status":"paid"}'
```

#### `DELETE /api/admin/donations/:id`

#### `GET /api/admin/donations/export.csv`
Download CSV (semua donasi).

#### `POST /api/admin/qris/preview`
Upload gambar QRIS → decode + preview.
```bash
curl -b cookies.txt -X POST http://localhost:3003/api/admin/qris/preview \
  -F "file=@qris.png"
```

---

## 🤖 Setup Macrodroid untuk Auto-Confirm

Lihat [README.md](../README.md) untuk panduan lengkap.

Quick example:
- **Trigger**: Notification from e-wallet
- **Action**: HTTP Request `POST` ke `{BASE_URL}/api/donations/{TOKEN}/paid?secret={WEBHOOK_SECRET}`

---

## 🗄️ Database Schema

Lihat [`migrate.js`](./migrate.js) untuk schema lengkap.

Tables:
- `settings` — key-value config
- `donations` — semua saweran
- `webhooks` — konfigurasi webhook
- `webhook_logs` — history pengiriman webhook
- `social_links` — social media links
- `session` — session admin (express-session)

---

## 🐛 Troubleshooting

**Q: Error "Database connection failed"**
- Pastikan PostgreSQL running
- Cek `DATABASE_URL` di `.env`
- Jalankan `npm run migrate` dulu

**Q: QR code tidak bisa di-scan**
- Pastikan QRIS_STATIC valid
- Cek di dashboard admin → Settings → test decode gambar QRIS

**Q: Admin tidak bisa login**
- Default: `admin` / `admin123`
- Cek `ADMIN_USERNAME` dan `ADMIN_PASSWORD` di `.env`

**Q: Webhook tidak terkirim**
- Cek tab Webhooks di dashboard admin → lihat log
- Test webhook manual dari dashboard

---

Made with ❤️ by DRP Network
