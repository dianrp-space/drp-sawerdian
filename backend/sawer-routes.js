/**
 * Public sawer routes: config, donations, leaderboard, Macrodroid webhook
 *
 * Flow sawer:
 * 1. User pilih nominal di frontend → POST /api/donations
 * 2. Backend generate UNIQUE_CODE random (1-200) → total = base + unique_code
 * 3. Backend generate QRIS dinamis dengan TOTAL (bukan base)
 * 4. User scan QR & bayar di e-wallet (nominal sesuai total, termasuk kode unik)
 * 5. E-wallet kirim notifikasi "Kamu menerima Rp X.XXX" ke HP
 * 6. Macrodroid tangkap notif → POST /api/macrodroid/confirm (Basic Auth)
 *    dengan payload { query: { notif_text, notif_app, status, timestamp } }
 * 7. Backend parse "Rp X.XXX" → cari donation dengan amount = X → mark as paid
 * 8. Trigger webhook notif (Discord/Telegram) → admin terima notifikasi
 */
import express from 'express';
import QRCode from 'qrcode';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { query } from './db.js';
import { generateDynamicQRIS } from './qris-generator.js';
import { dispatchWebhooks } from './webhook.js';
import { safeEqual } from './auth.js';

const router = express.Router();

/* ============================================================
   HELPERS
   ============================================================ */

async function getAllSettings() {
  const res = await query(`SELECT key, value FROM settings`);
  const obj = {};
  res.rows.forEach((row) => (obj[row.key] = row.value));
  return obj;
}

async function getEnabledSocials() {
  const res = await query(
    `SELECT platform, label, url, icon FROM social_links
     WHERE enabled = true ORDER BY display_order ASC, id ASC`
  );
  return res.rows;
}

function formatIDR(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(n);
}

function maskName(name) {
  if (!name) return 'Anonim';
  name = String(name).trim();
  if (name.length <= 2) return name[0] + '*';
  if (name.length <= 4) return name[0] + '***' + name[name.length - 1];
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

/**
 * Convert relative URL to absolute URL using BASE_URL from env
 * If URL is already absolute (starts with http/https) or empty, return as-is
 */
function toAbsoluteUrl(url) {
  if (!url || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const baseUrl = process.env.BASE_URL || '';
  if (!baseUrl) return url; // No BASE_URL configured, return relative URL
  // Remove trailing slash from baseUrl and ensure url starts with /
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = url.startsWith('/') ? url : '/' + url;
  return cleanBase + cleanPath;
}

/**
 * Parse nominal dari notification text e-wallet Indonesia.
 * Contoh:
 *   "Kamu telah menerima pembayaran Rp 5.023 dari xxx atas nama DIANXXXX."
 *   "Dana masuk Rp 10.000 dari John Doe"
 *   "Terima Rp 50,000"
 *   "IDR 5.023"
 *   "Rp5.023"
 * Return integer nominal, atau null kalau gak ketemu.
 */
function parseAmountFromNotif(text) {
  if (!text || typeof text !== 'string') return null;
  // Match "Rp" atau "IDR" diikuti angka dengan separator . atau ,
  // Asumsi: "." atau "," adalah thousand separator (Indonesia pakai .)
  // Contoh matches: "Rp 5.023", "Rp 5,023", "Rp5.023", "IDR 5.023"
  const match = text.match(/(?:Rp|IDR)\s*\.?\s*([\d]+(?:[.,][\d]+)*)/i);
  if (!match) return null;
  // Hapus semua separator (titik/koma) lalu parse
  const cleaned = match[1].replace(/[.,]/g, '');
  const n = parseInt(cleaned, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Basic Auth middleware
 * Header: Authorization: Basic base64(username:password)
 */
function basicAuth(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const authHeader = req.headers.authorization;
  console.log(`📨 [Macrodroid] Request from ${ip}, has Auth header: ${!!authHeader}`);
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.log(`❌ [Macrodroid] NO auth from ${ip} → 401`);
    res.set('WWW-Authenticate', 'Basic realm="DRP Sawer Macrodroid"');
    return res.status(401).json({ error: 'Basic Auth required' });
  }

  let decoded;
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ error: 'Invalid Basic Auth encoding' });
  }

  const idx = decoded.indexOf(':');
  if (idx === -1) {
    return res.status(401).json({ error: 'Invalid Basic Auth format' });
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  const expectedUser = process.env.MACRODROID_USERNAME || 'macrodroid';
  const expectedPass = process.env.MACRODROID_PASSWORD;

  if (!expectedPass) {
    console.log(`❌ [Macrodroid] MACRODROID_PASSWORD belum diset di .env → 500`);
    return res.status(500).json({
      error: 'MACRODROID_PASSWORD belum diset di .env server',
    });
  }
  // [SECURITY] Gunakan timing-safe comparison untuk mencegah timing attack
  if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
    console.log(`❌ [Macrodroid] Auth mismatch from ${ip}: tried user="${user}" (expected "${expectedUser}") → 401`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  console.log(`✅ [Macrodroid] Auth OK from ${ip} (user=${user})`);
  return next();
}

/* ============================================================
   RATE LIMITS
   ============================================================ */
const donationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: 'Terlalu banyak percobaan. Coba lagi dalam 5 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// [SECURITY] Rate limit untuk /api/macrodroid/confirm
const macrodroidLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 30,
  message: { error: 'Terlalu banyak request ke endpoint Macrodroid.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ============================================================
   GET /api/config
   ============================================================ */
router.get('/api/config', async (req, res) => {
  try {
    const settings = await getAllSettings();
    const socials = await getEnabledSocials();

    const presetAmounts = (settings.preset_amounts || '5000,10000,20000,50000,100000')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    res.json({
      creator: {
        name: settings.creator_name || 'DRP Network',
        tagline: settings.creator_tagline || '',
        website: settings.website_url || '',
        avatar: toAbsoluteUrl(settings.avatar_url || '/images/avatar.png'),
        banner: toAbsoluteUrl(settings.banner_url || ''),
        primaryColor: settings.primary_color || '#6c5ce7',
      },
      donation: {
        presets: presetAmounts,
        minAmount: parseInt(settings.min_amount || '2000', 10),
        maxAmount: parseInt(settings.max_amount || '5000000', 10),
        customEnabled: settings.custom_amount_enabled !== 'false',
        donorNameEnabled: settings.donor_name_enabled !== 'false',
        messageEnabled: settings.message_enabled !== 'false',
        qrExpiryHours: parseInt(settings.qr_expiry_hours || '24', 10),
      },
      socials,
      footer: settings.footer_text || '© 2026 DRP Network',
    });
  } catch (err) {
    console.error('❌ /api/config error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================================================
   POST /api/donations
   Body: { amount, donorName?, message? }
   Response: { ..., baseAmount, uniqueCode, amount (= base+unique), qrImage }
   ============================================================ */
router.post('/api/donations', donationLimiter, async (req, res) => {
  try {
    const { amount, donorName, message, isAnonymous } = req.body || {};
    const baseAmount = parseInt(amount, 10);

    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      return res.status(400).json({ error: 'Nominal tidak valid' });
    }

    const settings = await getAllSettings();
    const minAmount = parseInt(settings.min_amount || '2000', 10);
    const maxAmount = parseInt(settings.max_amount || '5000000', 10);
    const qrisStatic = settings.qris_static || process.env.QRIS_STATIC;

    if (!qrisStatic) {
      return res.status(500).json({
        error: 'QRIS statis belum dikonfigurasi. Silakan hubungi admin.',
      });
    }
    if (baseAmount < minAmount) {
      return res.status(400).json({ error: `Nominal minimum ${formatIDR(minAmount)}` });
    }
    // Max dihitung dari total (base + unique_code max 200), jadi base max = maxAmount - 200
    if (baseAmount > maxAmount - 200) {
      return res.status(400).json({ error: `Nominal maksimum ${formatIDR(maxAmount - 200)}` });
    }

    // Generate unique code random 1-200
    const uniqueCode = Math.floor(Math.random() * 200) + 1;
    const totalAmount = baseAmount + uniqueCode;

    const qrToken = crypto.randomBytes(16).toString('hex');
    const dynamicQris = generateDynamicQRIS(qrisStatic, totalAmount, 0);
    const qrImage = await QRCode.toDataURL(dynamicQris, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 500,
    });

    const expiryHours = parseInt(settings.qr_expiry_hours || '24', 10);
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const cleanName = donorName ? String(donorName).trim().substring(0, 100) : null;
    const cleanMessage = message ? String(message).trim().substring(0, 500) : null;

    const insertRes = await query(
      `INSERT INTO donations
         (qr_token, amount, base_amount, unique_code, donor_name, message, ip_address, user_agent, is_anonymous)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        qrToken,
        totalAmount,
        baseAmount,
        uniqueCode,
        cleanName,
        cleanMessage,
        req.ip || req.headers['x-forwarded-for'] || null,
        (req.headers['user-agent'] || '').substring(0, 500),
        isAnonymous === true
      ]
    );
    const donation = insertRes.rows[0];

    dispatchWebhooks('created', donation, settings).catch((e) =>
      console.error('webhook create error:', e.message)
    );

    res.json({
      ok: true,
      donationId: donation.id,
      qrToken: donation.qr_token,
      baseAmount: donation.base_amount,
      baseAmountFormatted: formatIDR(donation.base_amount),
      uniqueCode: donation.unique_code,
      amount: donation.amount,
      amountFormatted: formatIDR(donation.amount),
      qrImage,
      dynamicQris,
      expiresAt: expiresAt.toISOString(),
      message: `Bayar tepat ${formatIDR(donation.amount)} agar donasi terdeteksi otomatis.`,
    });
  } catch (err) {
    console.error('❌ POST /api/donations error:', err.message);
    res.status(500).json({ error: 'Gagal membuat donasi: ' + err.message });
  }
});

/* ============================================================
   GET /api/donations/:token
   ============================================================ */
router.get('/api/donations/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const res2 = await query(
      `SELECT * FROM donations WHERE qr_token = $1`,
      [token]
    );
    if (res2.rows.length === 0) {
      return res.status(404).json({ error: 'Donasi tidak ditemukan' });
    }
    const d = res2.rows[0];
    res.json({
      id: d.id,
      baseAmount: d.base_amount,
      uniqueCode: d.unique_code,
      amount: d.amount,
      amountFormatted: formatIDR(d.amount),
      donorName: d.donor_name,
      message: d.message,
      status: d.status,
      createdAt: d.created_at,
      paidAt: d.paid_at,
    });
  } catch (err) {
    console.error('❌ GET /api/donations/:token error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================================================
   POST /api/donations/:token/paid
   Auto-confirm by token. Pakai secret (legacy).
   ============================================================ */
router.post('/api/donations/:token/paid', async (req, res) => {
  try {
    const { token } = req.params;
    // [SECURITY] Hanya terima secret via header, BUKAN query string
    // (query string muncul di access log, browser history, dan proxy logs)
    const providedSecret = req.headers['x-webhook-secret'] || req.body?.secret;
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (!expectedSecret) {
      return res.status(500).json({ error: 'WEBHOOK_SECRET belum diset di server' });
    }
    // [SECURITY] Timing-safe comparison
    if (!safeEqual(providedSecret || '', expectedSecret)) {
      return res.status(401).json({ error: 'Invalid secret' });
    }

    const res1 = await query(`SELECT * FROM donations WHERE qr_token = $1`, [token]);
    if (res1.rows.length === 0) {
      return res.status(404).json({ error: 'Donasi tidak ditemukan' });
    }
    const donation = res1.rows[0];

    if (donation.status === 'paid') {
      return res.json({ ok: true, message: 'Donasi sudah paid', donation });
    }

    const res2 = await query(
      `UPDATE donations
       SET status = 'paid', paid_at = NOW(), paid_via = 'webhook'
       WHERE qr_token = $1
       RETURNING *`,
      [token]
    );
    const updated = res2.rows[0];

    const settings = await getAllSettings();
    dispatchWebhooks('paid', updated, settings).catch((e) =>
      console.error('webhook paid error:', e.message)
    );

    res.json({ ok: true, message: 'Donasi dikonfirmasi', donation: updated });
  } catch (err) {
    console.error('❌ POST /api/donations/:token/paid error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================================================
   POST /api/macrodroid/confirm
   AUTH: Basic Auth (username & password dari .env)
   PAYLOAD: { query: { notif_text, notif_app, notif_title, status, timestamp } }
   LOGIC:
     - Parse "Rp X.XXX" dari notif_text
     - Cari donation dengan amount = X (exact match), status=pending, recent (< 2 jam)
     - Kalau ketemu → mark as paid, simpan paid_via_app
     - Trigger webhook notif
   ============================================================ */
router.post('/api/macrodroid/confirm', macrodroidLimiter, basicAuth, async (req, res) => {
  try {
    // Macrodroid bisa mengirim data lewat 3 channel:
    //   1. URL Query String:  POST /api/macrodroid/confirm?notif_text=...&notif_app=...
    //      → ini yang PALING UMUM dipakai Macrodroid ("Add Parameters" = "query")
    //   2. JSON Body:         { "query": { notif_text, notif_app, ... } }  atau flat
    //   3. Form-urlencoded:   notif_text=...&notif_app=...
    //
    // Kita merge semua sumber jadi satu object `q` dengan prioritas:
    //   req.query > req.body.query > req.body
    const bodyFlat = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
      ? req.body
      : {};
    const bodyWrapped = (bodyFlat && bodyFlat.query && typeof bodyFlat.query === 'object')
      ? bodyFlat.query
      : {};
    const q = { ...bodyFlat, ...bodyWrapped, ...(req.query || {}) };

    // Ambil notif_text - coba banyak nama field
    const notifText =
      q.notif_text || q.notifText || q.notification_text || q.text ||
      q.message || q.body || q.content || '';

    // Ambil notif_app - coba banyak nama field
    const notifApp =
      q.notif_app || q.notifApp || q.notification_app || q.app ||
      q.app_name || q.packageName || q.package_name || '';

    const notifTitle = q.notif_title || q.notifTitle || q.notification_title || q.title || '';
    const status = (q.status || q.notification_status || '').toLowerCase();
    const timestamp = q.timestamp || q.time || Date.now();

    console.log(`📩 [Macrodroid] Hit: app="${notifApp}" status="${status}" text="${notifText.substring(0, 150)}"`);

    // DEBUG: log raw body kalau notifText kosong supaya user bisa lihat
    // apa yang sebenarnya dikirim Macrodroid
    if (!notifText) {
      const rawBody = JSON.stringify(req.body);
      const contentType = req.headers['content-type'] || 'none';
      const rawBodyString = req.rawBody || '(no rawBody)';
      console.log(`⚠️  [Macrodroid] notifText kosong!`);
      console.log(`   Content-Type: ${contentType}`);
      console.log(`   Parsed body:  ${rawBody}`);
      console.log(`   Raw body str: ${rawBodyString}`);
      console.log(`   req.query:    ${JSON.stringify(req.query)}`);
      console.log(`   req.url:      ${req.originalUrl || req.url}`);
      console.log(`   Headers: ${JSON.stringify(req.headers)}`);
    }

    // Filter hanya notifikasi paid
    if (status && status !== 'paid' && status !== 'received' && status !== 'success') {
      return res.json({ ok: false, message: `Ignored: status=${status}` });
    }

    // Parse nominal dari notif_text
    const amount = parseAmountFromNotif(notifText);
    if (amount === null) {
      console.log(`❌ [Macrodroid] Gagal parse amount dari notif_text: "${notifText}"`);
      console.log(`📋 [Macrodroid] Raw body: ${JSON.stringify(req.body)}`);
      const contentType = req.headers['content-type'] || 'none';
      return res.status(400).json({
        error: 'Gagal parse nominal dari notif_text',
        notif_text: notifText,
        notif_app: notifApp,
        raw_body: req.body,
        content_type: contentType,
        hint: notifText === ''
          ? 'Body kosong! Di Macrodroid HTTP Request: set Body type ke "application/json" dan isi dengan JSON. Pakai placeholder [notification_text], [app], [datetime]. Lihat /api/macrodroid/test untuk contoh payload.'
          : 'notif_text ada tapi tidak ada pola "Rp X.XXX". Pastikan notifikasi e-wallet mengandung nominal seperti "Kamu menerima Rp 100.000".',
      });
    }
    console.log(`🔍 [Macrodroid] Parsed amount: Rp ${amount}`);

    // Cari donation pending terbaru dengan amount tsb (umur < 2 jam)
    const findRes = await query(
      `SELECT * FROM donations
       WHERE status = 'pending' AND amount = $1
         AND created_at > NOW() - INTERVAL '2 hours'
       ORDER BY created_at DESC
       LIMIT 1`,
      [amount]
    );

    if (findRes.rows.length === 0) {
      console.log(`❌ [Macrodroid] Tidak ada donasi pending untuk amount ${amount}`);
      return res.status(404).json({
        error: 'Tidak ada donasi pending dengan nominal tersebut',
        amount,
        notif_text: notifText,
        notif_app: notifApp,
        hint: 'Pastikan user sudah klik Sawer dengan nominal tsb < 2 jam lalu',
      });
    }

    const donation = findRes.rows[0];

    // Mark as paid
    const updRes = await query(
      `UPDATE donations
       SET status = 'paid', paid_at = NOW(), paid_via = 'macrodroid', paid_via_app = $2
       WHERE id = $1
       RETURNING *`,
      [donation.id, notifApp || null]
    );
    const updated = updRes.rows[0];

    console.log(
      `✅ Macrodroid confirm: donation #${updated.id} (base Rp ${updated.base_amount} + unique ${updated.unique_code} = Rp ${amount}) via ${notifApp} → paid`
    );

    // Trigger webhook notif (Discord/Telegram)
    const settings = await getAllSettings();
    dispatchWebhooks('paid', updated, settings).catch((e) =>
      console.error('webhook paid error:', e.message)
    );

    res.json({
      ok: true,
      message: 'Donasi dikonfirmasi via Macrodroid',
      donation: {
        id: updated.id,
        baseAmount: updated.base_amount,
        baseAmountFormatted: formatIDR(updated.base_amount),
        uniqueCode: updated.unique_code,
        amount: updated.amount,
        amountFormatted: formatIDR(updated.amount),
        donorName: updated.donor_name,
        message: updated.message,
        status: updated.status,
        paidAt: updated.paid_at,
        paidVia: updated.paid_via,
        paidViaApp: updated.paid_via_app,
        matchedFrom: notifText.substring(0, 100),
      },
    });
  } catch (err) {
    console.error('❌ /api/macrodroid/confirm error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================================================
   GET /api/macrodroid/test
   [SECURITY] Dilindungi Basic Auth — tidak boleh publik karena
   mengekspos status konfigurasi server
   ============================================================ */
router.get('/api/macrodroid/test', basicAuth, (req, res) => {
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    endpoint: 'POST /api/macrodroid/confirm',
    auth: 'Basic Auth',
    example: {
      url: `${process.env.BASE_URL || 'http://localhost:3003'}/api/macrodroid/confirm`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('USER:PASSWORD').toString('base64'),
      },
      body: {
        query: {
          notif_text: 'Kamu telah menerima pembayaran Rp 5.023 dari xxx atas nama DIANXXXX.',
          notif_app: 'com.dana',
          notif_title: 'Payment received',
          status: 'paid',
          timestamp: 1756476503893,
        },
      },
    },
  });
});

/* ============================================================
   GET /api/leaderboard
   ============================================================ */
router.get('/api/leaderboard', async (req, res) => {
  try {
    const period = req.query.period || 'all';
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    let dateFilter = '';
    if (period === 'today') {
      dateFilter = `AND paid_at >= CURRENT_DATE`;
    } else if (period === 'month') {
      dateFilter = `AND paid_at >= DATE_TRUNC('month', NOW())`;
    }

    const result = await query(
      `SELECT id, amount, base_amount, unique_code, donor_name, message, paid_at, is_anonymous
       FROM donations
       WHERE status = 'paid' ${dateFilter}
       ORDER BY amount DESC, paid_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json({
      period,
      count: result.rows.length,
      items: result.rows.map((d, i) => ({
        rank: i + 1,
        baseAmount: d.base_amount,
        uniqueCode: d.unique_code,
        amount: d.amount,
        amountFormatted: formatIDR(d.amount),
        donorName: d.is_anonymous ? maskName(d.donor_name) : (d.donor_name || 'Anonim'),
        message: d.message || null,
        paidAt: d.paid_at,
      })),
    });
  } catch (err) {
    console.error('❌ /api/leaderboard error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================================================
   GET /api/leaderboard/stats
   ============================================================ */
router.get('/api/leaderboard/stats', async (req, res) => {
  try {
    const all = await query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total, MAX(amount) as max_amount
       FROM donations WHERE status = 'paid'`
    );
    const today = await query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
       FROM donations WHERE status = 'paid' AND paid_at >= CURRENT_DATE`
    );
    const month = await query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
       FROM donations WHERE status = 'paid' AND paid_at >= DATE_TRUNC('month', NOW())`
    );

    res.json({
      all: {
        count: parseInt(all.rows[0].cnt, 10),
        total: parseInt(all.rows[0].total, 10),
        totalFormatted: formatIDR(all.rows[0].total),
        maxAmount: parseInt(all.rows[0].max_amount || 0, 10),
        maxAmountFormatted: formatIDR(all.rows[0].max_amount || 0),
      },
      today: {
        count: parseInt(today.rows[0].cnt, 10),
        total: parseInt(today.rows[0].total, 10),
        totalFormatted: formatIDR(today.rows[0].total),
      },
      month: {
        count: parseInt(month.rows[0].cnt, 10),
        total: parseInt(month.rows[0].total, 10),
        totalFormatted: formatIDR(month.rows[0].total),
      },
    });
  } catch (err) {
    console.error('❌ /api/leaderboard/stats error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
