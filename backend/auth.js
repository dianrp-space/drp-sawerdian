/**
 * Admin authentication: express-session + connect-pg-simple + bcryptjs
 */
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from './db.js';

const PgSession = connectPgSimple(session);

/**
 * Timing-safe string comparison helper
 */
function safeEqual(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
      // Still run comparison to avoid timing leak on length
      crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Build session middleware
 * @param {object} config
 * @returns session middleware
 */
export function buildSessionMiddleware(config = {}) {
  const isProduction = process.env.NODE_ENV === 'production';

  // [SECURITY] Paksa keluar di production kalau secrets tidak di-set
  if (isProduction && !process.env.SESSION_SECRET) {
    console.error('❌ FATAL: SESSION_SECRET belum diset di .env. Server tidak bisa start di production.');
    process.exit(1);
  }
  if (isProduction && !process.env.ADMIN_PASSWORD) {
    console.error('❌ FATAL: ADMIN_PASSWORD belum diset di .env. Server tidak bisa start di production.');
    process.exit(1);
  }

  return session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfNotExists: false,
    }),
    name: 'drp.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      // 'auto' = secure true jika HTTPS, false jika HTTP. Aman untuk localhost HTTP & production HTTPS.
      // Set COOKIE_SECURE=true di .env untuk paksa secure=true (misal di balik HTTPS proxy tanpa trust proxy).
      secure: process.env.COOKIE_SECURE === 'true' ? true : 'auto',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
    },
    ...config,
  });
}

/**
 * Middleware: cek apakah user sudah login sebagai admin
 */
export function requireAdmin(req, res, next) {
  const hasSession = !!req.session;
  const isAdminSession = hasSession && req.session.admin === true;
  if (process.env.NODE_ENV !== 'production' || !isAdminSession) {
    console.log(`🔒 requireAdmin ${req.method} ${req.path}: sessionID=${req.sessionID} hasSession=${hasSession} admin=${isAdminSession}`);
  }
  if (isAdminSession) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized', code: 'NOT_LOGGED_IN' });
}

/**
 * Middleware: cek session valid (tidak wajib admin, untuk /api/admin/me)
 */
export function isAdmin(req) {
  return !!(req.session && req.session.admin === true);
}

/**
 * Login handler
 * Body: { username, password }
 */
export async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  const expectedUser = process.env.ADMIN_USERNAME || 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD || 'admin123';

  // [SECURITY] Gunakan timing-safe comparison untuk username
  if (!safeEqual(username, expectedUser)) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  // Support bcrypt hashed password atau plain text (untuk backward compat)
  const isHashed = expectedPass.startsWith('$2');
  const valid = isHashed
    ? await bcrypt.compare(password, expectedPass)
    : safeEqual(password, expectedPass); // [SECURITY] timing-safe

  if (!valid) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  req.session.admin = true;
  req.session.loginAt = new Date().toISOString();

  // Explicit save SEBELUM response - pastikan session tersimpan ke DB dulu
  // supaya browser sudah terima Set-Cookie dengan session ID yang valid
  req.session.save((err) => {
    if (err) {
      console.error('❌ Session save error:', err);
      return res.status(500).json({ error: 'Gagal menyimpan session' });
    }
    console.log('✅ Login OK, sessionID:', req.sessionID, 'admin:', req.session.admin);
    res.json({ ok: true, username: expectedUser });
  });
}

/**
 * Logout handler
 */
export function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal logout' });
    }
    res.clearCookie('drp.sid');
    res.json({ ok: true });
  });
}

/**
 * Get current admin info
 */
export function me(req, res) {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json({
    ok: true,
    username: process.env.ADMIN_USERNAME || 'admin',
    loginAt: req.session.loginAt,
  });
}

export { safeEqual };
export default { buildSessionMiddleware, requireAdmin, isAdmin, login, logout, me };