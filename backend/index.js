/**
 * Sawerdian - Main Server
 *
 * Stack: Express + PostgreSQL + Express Session
 * Routes:
 *   - Public sawer: /api/config, /api/donations, /api/leaderboard
 *   - Admin: /api/admin/*
 *   - Static: /, /leaderboard, /admin, /images/*, /assets/*, /uploads/*
 */
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { buildSessionMiddleware } from './auth.js';
import { testConnection } from './db.js';
import sawerRoutes from './sawer-routes.js';
import adminRoutes from './admin-routes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3003', 10);
const isProduction = process.env.NODE_ENV === 'production';

/* ============================================================
   SECURITY & MIDDLEWARE
   ============================================================ */

// Helmet dengan config yang allow inline style (untuk daisyUI) dan CDN
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
// Body parsers — gunakan opsi `verify` untuk capture raw body TANPA consume stream dua kali.
// (Kalau kita pakai `req.on('data')` manual, stream akan habis dibaca dan body-parser
//  akan gagal dengan "stream is not readable" — itulah bug yang sebelumnya terjadi.)
app.use(
  bodyParser.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      // Simpan raw body (string) untuk debugging di endpoint
      try {
        req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
      } catch {
        req.rawBody = '';
      }
    },
  })
);
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin requests (no Origin header, e.g. curl, server-to-server)
      if (!origin) return callback(null, true);
      // In development: allow localhost
      if (!isProduction) {
        if (
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:')
        ) {
          return callback(null, true);
        }
      }
      // [SECURITY] Di production: WAJIB set ALLOWED_ORIGIN.
      // Kalau kosong, semua cross-origin request ditolak.
      if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('CORS not allowed'));
    },
    credentials: true,
  })
);

// Trust proxy (untuk di belakang Nginx)
app.set('trust proxy', 1);

// Session
app.use(buildSessionMiddleware());

// Request logging — JANGAN log nilai cookie (session hijacking risk)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    // [SECURITY] Hanya log ada/tidaknya cookie, bukan nilainya
    const hasCookie = !!req.headers.cookie;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms [cookie:${hasCookie ? 'yes' : 'no'}]`);
  });
  next();
});


/* ============================================================
   STATIC FILES
   ============================================================ */

// Uploads (logo, banner dari admin)
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d',
    fallthrough: true,
  })
);

// Root static (frontend)
const ROOT_DIR = path.join(__dirname, '..');
app.use(
  express.static(ROOT_DIR, {
    maxAge: isProduction ? '1d' : 0,
    index: false,
    fallthrough: true,
  })
);

/* ============================================================
   HEALTH CHECK
   ============================================================ */
app.get('/api/health', async (req, res) => {
  const db = await testConnection();
  res.json({
    status: db.ok ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    database: db.ok ? 'connected' : 'disconnected',
    // [SECURITY] Jangan expose pesan error DB ke publik di production
    ...(db.error && !isProduction ? { dbError: db.error } : {}),
  });
});

/* ============================================================
   API ROUTES
   ============================================================ */
app.use(sawerRoutes);
app.use(adminRoutes);

/* ============================================================
   PAGE ROUTES
   ============================================================ */
function sendPage(res, file) {
  res.sendFile(file, { root: ROOT_DIR }, (err) => {
    if (err) {
      console.error(`❌ sendFile error for ${file}:`, err.code || err.message);
      if (err.code === 'ENOENT') {
        res.status(404).send(`File not found: ${file}`);
      } else {
        res.status(500).send('Error serving page');
      }
    }
  });
}

app.get('/', (req, res) => sendPage(res, 'index.html'));
app.get('/index.html', (req, res) => sendPage(res, 'index.html'));
app.get('/leaderboard', (req, res) => sendPage(res, 'leaderboard.html'));
app.get('/leaderboard.html', (req, res) => sendPage(res, 'leaderboard.html'));
app.get('/admin', (req, res) => sendPage(res, 'admin.html'));
app.get('/admin.html', (req, res) => sendPage(res, 'admin.html'));
app.get(/^\/admin(\/.*)?$/, (req, res) => sendPage(res, 'admin.html'));
app.get('/pay', (req, res) => sendPage(res, 'pay.html'));
app.get('/pay.html', (req, res) => sendPage(res, 'pay.html'));
app.get('/api-documentation.html', (req, res) => sendPage(res, 'api-documentation.html'));
app.get('/api-documentation', (req, res) => sendPage(res, 'api-documentation.html'));



/* ============================================================
   404 & ERROR HANDLERS
   ============================================================ */

// API 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint tidak ditemukan', path: req.path });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File terlalu besar' });
  }
  if (err.message === 'CORS not allowed') {
    return res.status(403).json({ error: 'Origin tidak diizinkan' });
  }
  res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message,
  });
});

/* ============================================================
   START SERVER
   ============================================================ */
async function start() {
  console.log('🚀 Starting Sawerdian server...\n');

  // Test database
  const dbTest = await testConnection();
  if (!dbTest.ok) {
    console.error('❌ Database connection failed:', dbTest.error);
    console.error('   Jalankan: cd backend && npm run migrate');
    console.error('   Pastikan DATABASE_URL di .env sudah benar.\n');
    process.exit(1);
  }
  console.log('✅ Database connected:', dbTest.time);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`   • Halaman sawer:  http://localhost:${PORT}/`);
    console.log(`   • Leaderboard:    http://localhost:${PORT}/leaderboard`);
    console.log(`   • Admin:          http://localhost:${PORT}/admin`);
    console.log(`   • API health:     http://localhost:${PORT}/api/health`);
    console.log(`   • Environment:    ${isProduction ? 'production' : 'development'}`);
    console.log('');
  });
}

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received. Shutting down...');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received. Shutting down...');
  process.exit(0);
});
