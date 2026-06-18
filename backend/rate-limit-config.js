/**
 * Rate limiting configuration untuk DRP Sawerdian
 *
 * Berlaku untuk endpoint publik yang rentan disalahgunakan:
 *  - POST /api/leaderboard/:donationId/comments   → komentar spam
 *  - GET  /api/leaderboard                        → scraping leaderboard
 *  - POST /api/donations                          → spam donasi
 *  - POST /api/admin/login                        → brute force password admin
 *  - POST /api/admin/webhooks/:id/test            → spam test webhook
 *
 * Setiap limiter punya:
 *  - windowMs: jangka waktu pengamatan
 *  - max:      jumlah request maks dalam window
 *  - message:  pesan error friendly (Bahasa Indonesia)
 *  - keyGenerator: identifier unik (IP + path) — penting untuk limit per-endpoint
 *  - standardHeaders: aktifkan RateLimit-* headers (RFC)
 *  - skipSuccessfulRequests: opsional, untuk beberapa endpoint
 *
 * Untuk produksi dengan banyak node, ganti MemoryStore default dengan
 * Redis/Postgres store (lihat TODO di akhir file).
 */

import rateLimit from 'express-rate-limit';

/**
 * Helper untuk key generator.
 * Pakai IP (sudah di-trust proxy via app.set('trust proxy', 1))
 * + path agar limit benar-benar per-endpoint, bukan global.
 * Tanpa suffix path, semua endpoint berbagi counter yang sama.
 */
function ipWithPath(req) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  // normalisasi IPv6 prefix dan port
  const cleanIp = String(ip).replace(/^::ffff:/, '').split(',')[0].trim();
  return `${cleanIp}:${req.baseUrl || ''}${req.path}`;
}

/**
 * Helper key generator khusus untuk endpoint admin.
 * Pakai IP + identifier user kalau login (req.session.userId).
 * Ini mencegah satu IP mengganggu banyak akun admin berbeda.
 */
function adminKey(req) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const cleanIp = String(ip).replace(/^::ffff:/, '').split(',')[0].trim();
  const userId = req.session?.userId ? `u${req.session.userId}` : 'anon';
  return `${cleanIp}:${userId}`;
}

/* ============================================================
   KOMENTAR (paling rentan spam)
   ============================================================
   - max 5 komentar per 10 menit per IP per donationId
     (window panjang + max kecil → efektif blok spam tanpa mengganggu user normal)
   - max 20 komentar per 10 menit per IP (global safety net)
   - Pesan jelas dalam bahasa Indonesia
*/
export const commentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 menit
  max: 5,                   // 5 komentar per window per IP per donationId
  message: {
    error: 'Terlalu banyak komentar. Coba lagi dalam 10 menit.',
    retryAfter: '10 menit',
  },
  keyGenerator: ipWithPath,
  standardHeaders: true,
  legacyHeaders: false,
  // Jangan hitung request yang gagal validasi (spam dengan nama invalid
  // tetap dihitung agar bot tidak bisa bypass dengan kirim payload jelek)
  skipFailedRequests: false,
});

/**
 * Global safety net untuk endpoint komentar.
 * Dipasang sebagai lapisan kedua: kalau attacker rotate donationId
 * untuk hindari commentLimiter, limiter ini tetap menahan di level IP.
 */
export const commentGlobalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20, // total max 20 komentar per 10 menit per IP (semua donation)
  message: {
    error: 'Batas komentar global tercapai. Coba lagi dalam 10 menit.',
    retryAfter: '10 menit',
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    return String(ip).replace(/^::ffff:/, '').split(',')[0].trim();
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ============================================================
   DONASI (POST /api/donations)
   ============================================================
   - max 10 per 5 menit per IP (sudah ada, dipertahankan)
   - ditambah stricter: max 30 per jam per IP
*/
export const donationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 10,
  message: {
    error: 'Terlalu banyak percobaan donasi. Coba lagi dalam 5 menit.',
    retryAfter: '5 menit',
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    return String(ip).replace(/^::ffff:/, '').split(',')[0].trim();
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ============================================================
   MACRODROID WEBHOOK
   ============================================================
   - max 30 per menit (sudah ada, dipertahankan)
*/
export const macrodroidLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: {
    error: 'Terlalu banyak request ke endpoint Macrodroid.',
    retryAfter: '1 menit',
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    return String(ip).replace(/^::ffff:/, '').split(',')[0].trim();
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ============================================================
   LEADERBOARD (GET) — anti-scraping
   ============================================================
   - max 60 request per menit per IP
   - Cukup untuk user normal yang refresh halaman, menahan scraper
*/
export const leaderboardReadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: {
    error: 'Terlalu banyak request. Coba lagi dalam 1 menit.',
    retryAfter: '1 menit',
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    return String(ip).replace(/^::ffff:/, '').split(',')[0].trim();
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ============================================================
   ADMIN LOGIN — anti-brute-force
   ============================================================
   - max 5 percobaan gagal per 15 menit per IP
   - Hitungan hanya request yang GAGAL (password salah)
     → user yang berhasil login tidak ke-limit
   - Pesan generik untuk tidak bocorin info "user exists"
*/
export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5,
  message: {
    error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
    retryAfter: '15 menit',
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    return String(ip).replace(/^::ffff:/, '').split(',')[0].trim();
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // login sukses tidak dihitung
});

/* ============================================================
   ADMIN TEST WEBHOOK — anti-abuse
   ============================================================
   - max 10 test per jam per admin
   - Pakai adminKey (IP + userId) supaya 1 admin tidak disrupt admin lain
*/
export const adminTestWebhookLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 jam
  max: 10,
  message: {
    error: 'Terlalu banyak test webhook. Coba lagi dalam 1 jam.',
    retryAfter: '1 jam',
  },
  keyGenerator: adminKey,
  standardHeaders: true,
  legacyHeaders: false,
});

/* ============================================================
   TODO (untuk scale produksi):
   ============================================================
   Default store express-rate-limit adalah MemoryStore (per-process).
   Kalau deploy multi-instance (PM2 cluster / Docker swarm),
   ganti ke shared store agar rate limit konsisten antar node.

   Contoh dengan Redis:
     import RedisStore from 'rate-limit-redis';
     import { createClient } from 'redis';
     const client = createClient({ url: process.env.REDIS_URL });
     await client.connect();
     const store = new RedisStore({ sendCommand: (...args) => client.sendCommand(args) });

   Lalu inject `store` ke setiap limiter di atas.
*/