# 💸 Sawerdian

Website sawer (tipping) mirip Saweria/Trakteer, khusus pembayaran via **QRIS**.
Dibangun dengan Node.js + Express + PostgreSQL + daisyUI (Tailwind CSS).

## ✨ Fitur

- 🎯 **Halaman sawer** dengan preset nominal + custom amount
- 💬 **Pesan/dukungan** opsional yang disimpan ke database
- 🏆 **Leaderboard publik** dengan mask nama untuk privasi
- 🎨 **Dashboard admin** untuk kelola branding, identitas, webhooks, social links
- 🔔 **Webhook notifikasi** ke Discord / Telegram / Custom JSON
- 🤖 **Auto-confirm via Macrodroid** — tangkap notifikasi e-wallet → POST ke endpoint (Basic Auth)
- 📊 **Statistik lengkap**: total, harian, mingguan, top 5 sawer
- 📥 **Export CSV** untuk rekap donasi
- 🌓 **Dark mode** (daisyUI theme)
- 📱 **Responsive** untuk mobile & desktop

## 🚀 Quick Start

### 1. Setup Database PostgreSQL
Buat database dan user:
```sql
CREATE USER sawerdian WITH PASSWORD 'your_password';
CREATE DATABASE sawerdian OWNER sawerdian;
GRANT ALL PRIVILEGES ON DATABASE sawerdian TO sawerdian;
```

### 2. Setup Backend
```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL=postgresql://sawerdian:your_password@localhost:5432/sawerdian
ADMIN_PASSWORD=ganti_password_admin
SESSION_SECRET=ganti_dengan_string_random_panjang
QRIS_STATIC=00020101021126...   # (opsional, bisa di-set dari dashboard)
WEBHOOK_SECRET=ganti_string_random
MACRODROID_USERNAME=macrodroid
MACRODROID_PASSWORD=ganti_password_macrodroid_kuat
```

### 3. Migrate Database
```bash
npm run migrate
```

### 4. Jalankan Server
```bash
npm start
```

Akses:
- 🌐 Halaman sawer: http://localhost:3003
- 💳 Halaman bayar: http://localhost:3003/pay
- 🏆 Leaderboard: http://localhost:3003/leaderboard
- 🔐 Admin: http://localhost:3003/admin (default: `admin` / `admin123`)
- 📖 API Docs: http://localhost:3003/api-documentation

### 5. Setup QRIS Static
Login ke `/admin` → tab **Settings** → upload gambar QRIS (auto-decode) atau paste string manual.

## 📁 Struktur Project

```
drp-sawerdian/
├── index.html              # Halaman sawer publik
├── leaderboard.html        # Halaman leaderboard publik
├── pay.html                # Halaman pembayaran
├── admin.html              # Login + dashboard admin
├── api-documentation.html  # Dokumentasi API
├── assets/
│   ├── css/style.css       # Custom CSS (animasi, gradient, dll)
│   └── js/
│       ├── sawer.js        # Logic halaman sawer
│       ├── leaderboard.js  # Logic leaderboard
│       └── admin.js        # Logic dashboard admin
├── images/                 # Asset statis (logo, banner, QRIS)
└── backend/
    ├── index.js            # Main server
    ├── db.js               # PostgreSQL connection
    ├── auth.js             # Session admin
    ├── sawer-routes.js     # API publik + Macrodroid
    ├── admin-routes.js     # API admin
    ├── webhook.js          # Webhook dispatcher
    ├── qris-generator.js   # QRIS dynamic generator
    ├── qris-crc.js         # CRC16-CCITT
    ├── qris-image.js       # QR image decoder (jsQR)
    ├── migrate.js          # Schema migration
    └── .env.example
```

## 🔌 API Endpoints

Lihat dokumentasi lengkap di [api-documentation.html](api-documentation.html) atau akses `/api-documentation` saat server berjalan.

### Ringkasan

| Method | Path | Auth | Keterangan |
|--------|------|------|------------|
| GET | `/api/health` | — | Status server |
| GET | `/api/config` | — | Konfigurasi publik |
| POST | `/api/donations` | — | Buat donasi + generate QRIS |
| GET | `/api/donations/:token` | — | Cek status donasi |
| POST | `/api/donations/:token/paid` | WEBHOOK_SECRET | Konfirmasi donasi by token |
| GET | `/api/leaderboard` | — | Top sawer |
| GET | `/api/leaderboard/stats` | — | Statistik sawer |
| POST | `/api/macrodroid/confirm` | Basic Auth | Konfirmasi via notif e-wallet |
| GET | `/api/macrodroid/test` | Basic Auth | Test koneksi Macrodroid |
| POST | `/api/admin/login` | — | Login admin |
| POST | `/api/admin/logout` | Session | Logout |
| GET | `/api/admin/me` | Session | Info session |
| GET | `/api/admin/dashboard` | Session | Statistik dashboard |
| GET/PUT | `/api/admin/settings` | Session | Kelola settings |
| POST | `/api/admin/branding/logo` | Session | Upload logo |
| POST | `/api/admin/branding/banner` | Session | Upload banner |
| DELETE | `/api/admin/branding/:type` | Session | Reset branding |
| GET/POST/PUT/DELETE | `/api/admin/webhooks` | Session | CRUD webhook |
| POST | `/api/admin/webhooks/:id/test` | Session | Test webhook |
| GET | `/api/admin/webhook-logs` | Session | Log webhook |
| GET/POST/PUT/DELETE | `/api/admin/socials` | Session | CRUD social links |
| GET | `/api/admin/donations` | Session | List donasi |
| GET | `/api/admin/donations/:id` | Session | Detail donasi |
| PATCH | `/api/admin/donations/:id/status` | Session | Update status donasi |
| DELETE | `/api/admin/donations/:id` | Session | Hapus donasi |
| GET | `/api/admin/donations/export.csv` | Session | Export CSV |
| POST | `/api/admin/qris/preview` | Session | Decode QRIS image |

## 🤖 Auto-Confirm dengan Macrodroid

Macrodroid menangkap notifikasi e-wallet dan mengirimkannya ke server untuk auto-confirm donasi.

**Setup di `.env`:**
```env
MACRODROID_USERNAME=macrodroid
MACRODROID_PASSWORD=password_kuat_disini
```

**Setup di Macrodroid:**
1. Buat macro dengan **Trigger**: Notifikasi dari aplikasi e-wallet (GoPay, DANA, OVO, dll.)
2. **Action**: HTTP Request → POST ke:
   ```
   https://yourdomain.com/api/macrodroid/confirm
   ```
3. **Headers**:
   ```
   Authorization: Basic <base64(username:password)>
   Content-Type: application/json
   ```
4. **Body** (JSON):
   ```json
   {
     "query": {
       "notif_text": "[notification_text]",
       "notif_app": "[app_package]",
       "status": "paid"
     }
   }
   ```

Untuk test koneksi, hit `GET /api/macrodroid/test` dengan Basic Auth yang sama — endpoint akan return contoh payload yang benar.

> **Catatan**: `WEBHOOK_SECRET` dan endpoint `/api/donations/:token/paid` masih tersedia sebagai cara konfirmasi alternatif (manual/legacy). Secret harus dikirim via header `X-Webhook-Secret`, bukan query string.

## 🚀 Deployment (aaPanel / VPS)

1. Install **Node.js** & **PostgreSQL** di server
2. Buat database `sawerdian` + user
3. Upload project ke `/www/wwwroot/sawer.domain.com`
4. ```bash
   cd backend && npm install --production
   ```
5. Setup `.env` (copy dari `.env.example`, isi semua nilai)
6. ```bash
   npm run migrate
   ```
7. Jalankan dengan **PM2**:
   ```bash
   pm2 start index.js --name sawer
   pm2 save
   pm2 startup
   ```
8. Setup **Nginx** reverse proxy:
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:3003;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_cache_bypass $http_upgrade;
   }
   ```
9. Enable **HTTPS** via Let's Encrypt
10. Set `ALLOWED_ORIGIN` di `.env` ke domain produksi

## 📝 Catatan

- Default preset: 5K, 10K, 20K, 50K, 100K
- Min nominal: Rp 2.000, Max: Rp 5.000.000
- Setiap donasi ditambah **unique code** (1–200) agar nominal unik dan bisa dideteksi otomatis
- Privasi: nama donor selalu di-mask di leaderboard publik
- Session cookie: `drp.sid`, berlaku 7 hari

## 📄 Lisensi

Free to use. By Dian Rama Putra.