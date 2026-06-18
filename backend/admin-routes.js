/**
 * Admin routes: settings, branding, webhooks, socials, donations management
 * Semua endpoint butuh session admin (requireAuth middleware di-mount di index.js)
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { query } from './db.js';
import { requireAdmin, login, logout, me } from './auth.js';
import { dispatchWebhooks, testWebhook } from './webhook.js';
import { generateDynamicQRIS } from './qris-generator.js';
import { decodeQRFromImage } from './qris-image.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/* ============================================================
   UPLOADS SETUP
   ============================================================ */
const IMAGES_DIR = path.join(__dirname, '../images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

const MAX_UPLOAD = parseInt(process.env.MAX_UPLOAD_SIZE || '2097152', 10); // 2MB

// [SECURITY] SVG dihapus — SVG bisa berisi <script> tag → stored XSS
const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = /image\/(jpeg|png|gif|webp)/.test(file.mimetype);
  if (extOk && mimeOk) return cb(null, true);
  cb(new Error('Format file tidak didukung. Gunakan JPG, PNG, GIF, atau WEBP.'));
};

function makeStorage(targetDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, targetDir),
    filename: (req, file, cb) => {
      // Gunakan nama file asli sesuai permintaan
      cb(null, file.originalname);
    },
  });
}

const uploadLogo = multer({
  storage: makeStorage(IMAGES_DIR),
  fileFilter,
  limits: { fileSize: MAX_UPLOAD },
});

const uploadBanner = multer({
  storage: makeStorage(IMAGES_DIR),
  fileFilter,
  limits: { fileSize: MAX_UPLOAD },
});


/* ============================================================
   HELPERS
   ============================================================ */
function formatIDR(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(n);
}

async function getAllSettings() {
  const res = await query(`SELECT key, value FROM settings`);
  const obj = {};
  res.rows.forEach((row) => (obj[row.key] = row.value));
  return obj;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) 
     VALUES ($1, $2, NOW()) 
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

/* ============================================================
   AUTH (sub-route)
   ============================================================ */
router.post('/api/admin/login', login);
router.post('/api/admin/logout', logout);
router.get('/api/admin/me', me);

/* ============================================================
   DASHBOARD STATS
   ============================================================ */
router.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const all = await query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total 
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
    const pending = await query(
      `SELECT COUNT(*) as cnt FROM donations WHERE status = 'pending'`
    );
    // 7 hari terakhir
    const daily = await query(
      `SELECT DATE(paid_at) as day, COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
       FROM donations
       WHERE status = 'paid' AND paid_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY DATE(paid_at)
       ORDER BY day ASC`
    );
    // Top 5 sawer
    const top = await query(
      `SELECT amount, donor_name, paid_at FROM donations 
       WHERE status = 'paid' 
       ORDER BY amount DESC LIMIT 5`
    );

    res.json({
      all: { count: parseInt(all.rows[0].cnt, 10), total: parseInt(all.rows[0].total, 10) },
      today: { count: parseInt(today.rows[0].cnt, 10), total: parseInt(today.rows[0].total, 10) },
      month: { count: parseInt(month.rows[0].cnt, 10), total: parseInt(month.rows[0].total, 10) },
      pending: { count: parseInt(pending.rows[0].cnt, 10) },
      daily: daily.rows.map((r) => ({
        day: r.day,
        count: parseInt(r.cnt, 10),
        total: parseInt(r.total, 10),
      })),
      top: top.rows.map((r) => ({
        amount: parseInt(r.amount, 10),
        amountFormatted: formatIDR(r.amount),
        donorName: r.donor_name || 'Anonim',
        paidAt: r.paid_at,
      })),
    });
  } catch (err) {
    console.error('❌ /api/admin/dashboard error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================================================
   SETTINGS
   ============================================================ */
router.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Gagal load settings' });
  }
});

router.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const updates = req.body || {};
    // Whitelist keys yang boleh di-update
    const allowed = [
      'creator_name',
      'creator_tagline',
      'website_url',
      'avatar_url',
      'banner_url',
      'primary_color',
      'qris_static',
      'preset_amounts',
      'min_amount',
      'max_amount',
      'custom_amount_enabled',
      'donor_name_enabled',
      'message_enabled',
      'qr_expiry_hours',
      'footer_text',
    ];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        await setSetting(key, String(updates[key]));
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ PUT /api/admin/settings error:', err.message);
    res.status(500).json({ error: 'Gagal update settings' });
  }
});

/* ============================================================
   BRANDING UPLOAD
   ============================================================ */
router.post('/api/admin/branding/logo', requireAdmin, uploadLogo.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File wajib diupload' });
    const url = `/images/${req.file.originalname}`;
    await setSetting('avatar_url', url);
    res.json({ ok: true, url, filename: req.file.originalname });
  } catch (err) {
    console.error('❌ upload logo error:', err.message);
    res.status(500).json({ error: 'Gagal upload' });
  }
});

router.post('/api/admin/branding/banner', requireAdmin, uploadBanner.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File wajib diupload' });
    const url = `/images/${req.file.originalname}`;
    await setSetting('banner_url', url);
    res.json({ ok: true, url, filename: req.file.originalname });
  } catch (err) {
    console.error('❌ upload banner error:', err.message);
    res.status(500).json({ error: 'Gagal upload' });
  }
});


router.delete('/api/admin/branding/:type', requireAdmin, async (req, res) => {
  try {
    const type = req.params.type;
    const settingKey = type === 'banner' ? 'banner_url' : 'avatar_url';
    const defaultVal = type === 'banner' ? '' : '/images/avatar.png';
    await setSetting(settingKey, defaultVal);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal hapus' });
  }
});

/* ============================================================
   WEBHOOKS CRUD
   ============================================================ */
router.get('/api/admin/webhooks', requireAdmin, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM webhooks ORDER BY id DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal load webhooks' });
  }
});

// [SECURITY] Validasi URL webhook: wajib https di production, cek format URL
function validateWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && parsed.protocol !== 'https:') {
      return 'URL webhook wajib menggunakan HTTPS di production';
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL webhook harus menggunakan protokol http atau https';
    }
    return null; // valid
  } catch {
    return 'URL webhook tidak valid';
  }
}

router.post('/api/admin/webhooks', requireAdmin, async (req, res) => {
  try {
    const { name, type, url, enabled, trigger_on, secret } = req.body || {};
    if (!name || !type || !url) {
      return res.status(400).json({ error: 'name, type, url wajib diisi' });
    }
    if (!['discord', 'telegram', 'custom'].includes(type)) {
      return res.status(400).json({ error: 'type harus discord/telegram/custom' });
    }
    if (!['created', 'paid', 'both'].includes(trigger_on || 'paid')) {
      return res.status(400).json({ error: 'trigger_on harus created/paid/both' });
    }
    // [SECURITY] Validasi URL untuk mencegah SSRF
    const urlError = validateWebhookUrl(url);
    if (urlError) return res.status(400).json({ error: urlError });
    const result = await query(
      `INSERT INTO webhooks (name, type, url, enabled, trigger_on, secret)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, type, url, enabled !== false, trigger_on || 'paid', secret || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ POST webhooks error:', err.message);
    res.status(500).json({ error: 'Gagal tambah webhook' });
  }
});

router.put('/api/admin/webhooks/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, url, enabled, trigger_on, secret } = req.body || {};
    // [SECURITY] Validasi URL kalau diupdate
    if (url) {
      const urlError = validateWebhookUrl(url);
      if (urlError) return res.status(400).json({ error: urlError });
    }
    const result = await query(
      `UPDATE webhooks SET 
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        url = COALESCE($3, url),
        enabled = COALESCE($4, enabled),
        trigger_on = COALESCE($5, trigger_on),
        secret = COALESCE($6, secret)
       WHERE id = $7 RETURNING *`,
      [name, type, url, enabled, trigger_on, secret, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Webhook tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal update webhook' });
  }
});

router.delete('/api/admin/webhooks/:id', requireAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM webhooks WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal hapus webhook' });
  }
});

router.post('/api/admin/webhooks/:id/test', requireAdmin, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM webhooks WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Webhook tidak ditemukan' });
    const testResult = await testWebhook(result.rows[0]);
    res.json(testResult);
  } catch (err) {
    res.status(500).json({ error: 'Gagal test webhook' });
  }
});

router.get('/api/admin/webhook-logs', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const result = await query(
      `SELECT wl.*, w.name as webhook_name, w.type as webhook_type
       FROM webhook_logs wl
       LEFT JOIN webhooks w ON w.id = wl.webhook_id
       ORDER BY wl.sent_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal load logs' });
  }
});

/* ============================================================
   SOCIAL LINKS CRUD
   ============================================================ */
router.get('/api/admin/socials', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM social_links ORDER BY display_order ASC, id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal load socials' });
  }
});

router.post('/api/admin/socials', requireAdmin, async (req, res) => {
  try {
    const { platform, label, url, icon, display_order, enabled } = req.body || {};
    if (!platform || !url) return res.status(400).json({ error: 'platform dan url wajib diisi' });
    const result = await query(
      `INSERT INTO social_links (platform, label, url, icon, display_order, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        platform,
        label || null,
        url,
        icon || platform,
        parseInt(display_order || 0, 10),
        enabled !== false,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal tambah social' });
  }
});

router.put('/api/admin/socials/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { platform, label, url, icon, display_order, enabled } = req.body || {};
    const result = await query(
      `UPDATE social_links SET 
        platform = COALESCE($1, platform),
        label = COALESCE($2, label),
        url = COALESCE($3, url),
        icon = COALESCE($4, icon),
        display_order = COALESCE($5, display_order),
        enabled = COALESCE($6, enabled)
       WHERE id = $7 RETURNING *`,
      [platform, label, url, icon, display_order, enabled, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Social tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal update social' });
  }
});

router.delete('/api/admin/socials/:id', requireAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM social_links WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal hapus social' });
  }
});

/* ============================================================
   DONATIONS MANAGEMENT
   ============================================================ */
router.get('/api/admin/donations', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = (page - 1) * limit;
    const { status, q, period } = req.query;

    const where = [];
    const params = [];
    let i = 1;
    if (status && ['pending', 'paid', 'expired', 'cancelled'].includes(status)) {
      where.push(`status = $${i++}`);
      params.push(status);
    }
    if (period === 'today') where.push(`created_at >= CURRENT_DATE`);
    else if (period === 'month') where.push(`created_at >= DATE_TRUNC('month', NOW())`);
    if (q) {
      where.push(`(donor_name ILIKE $${i} OR message ILIKE $${i} OR qr_token ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*) as total, COALESCE(SUM(amount), 0) as sum_amount 
       FROM donations ${whereSql}`,
      params
    );

    const result = await query(
      `SELECT * FROM donations ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    res.json({
      page,
      limit,
      total: parseInt(countRes.rows[0].total, 10),
      totalAmount: parseInt(countRes.rows[0].sum_amount, 10),
      items: result.rows,
    });
  } catch (err) {
    console.error('❌ /api/admin/donations error:', err.message);
    res.status(500).json({ error: 'Gagal load donations' });
  }
});

router.get('/api/admin/donations/:id(\\d+)', requireAdmin, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM donations WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Donasi tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal load donation' });
  }
});

router.patch('/api/admin/donations/:id(\\d+)/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['pending', 'paid', 'expired', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid' });
    }

    // Get old donation
    const old = await query(`SELECT * FROM donations WHERE id = $1`, [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Donasi tidak ditemukan' });

    const paidAt = status === 'paid' ? 'NOW()' : 'paid_at';
    const result = await query(
      `UPDATE donations 
       SET status = $1, paid_at = ${paidAt}, paid_via = CASE WHEN $1::varchar(20) = 'paid' AND paid_via IS NULL THEN 'admin' ELSE paid_via END
       WHERE id = $2 RETURNING *`,
      [status, id]
    );

    // Trigger webhook kalau berubah ke paid
    if (status === 'paid' && old.rows[0].status !== 'paid') {
      const settings = await getAllSettings();
      dispatchWebhooks('paid', result.rows[0], settings).catch((e) =>
        console.error('webhook error:', e.message)
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ PATCH status error:', err.message);
    console.error('   Params:', { status, id });
    console.error('   Stack:', err.stack);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({
      error: 'Gagal update status',
      ...(isDev ? { detail: err.message, code: err.code } : {}),
    });
  }
});

router.delete('/api/admin/donations/:id(\\d+)', requireAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM donations WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal hapus' });
  }
});

router.delete('/api/admin/donations/batch', requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array ID wajib diisi' });
    }
    
    // Create parameterized placeholders like $1, $2, $3
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await query(`DELETE FROM donations WHERE id IN (${placeholders})`, ids);
    
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: 'Gagal hapus batch' });
  }
});

router.patch('/api/admin/donations/batch/status', requireAdmin, async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array ID wajib diisi' });
    }
    if (!['pending', 'paid', 'expired', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid' });
    }

    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const paidAt = status === 'paid' ? 'NOW()' : 'paid_at';
    
    // Lakukan update massal
    await query(
      `UPDATE donations 
       SET status = $1, paid_at = ${paidAt}, paid_via = CASE WHEN $1::varchar(20) = 'paid' AND paid_via IS NULL THEN 'admin' ELSE paid_via END
       WHERE id IN (${placeholders})`,
      [status, ...ids]
    );

    res.json({ ok: true, updated: ids.length });
  } catch (err) {
    console.error('❌ PATCH batch status error:', err.message);
    res.status(500).json({ error: 'Gagal update status batch' });
  }
});

router.get('/api/admin/donations/export.csv', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, qr_token, amount, donor_name, message, status, paid_via, 
              to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
              to_char(paid_at, 'YYYY-MM-DD HH24:MI:SS') as paid_at
       FROM donations ORDER BY created_at DESC`
    );

    const header = ['ID', 'Token', 'Amount', 'Donor Name', 'Message', 'Status', 'Paid Via', 'Created At', 'Paid At'];
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [header.join(',')];
    result.rows.forEach((r) => {
      lines.push(
        [r.id, r.qr_token, r.amount, r.donor_name, r.message, r.status, r.paid_via, r.created_at, r.paid_at]
          .map(escape)
          .join(',')
      );
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="donations-${Date.now()}.csv"`);
    res.send('\uFEFF' + lines.join('\n')); // BOM for Excel
  } catch (err) {
    res.status(500).json({ error: 'Gagal export' });
  }
});

/* ============================================================
   QRIS PREVIEW (decode uploaded QRIS image)
   ============================================================ */
router.post('/api/admin/qris/preview', requireAdmin, uploadLogo.single('file'), async (req, res) => {

  try {
    if (!req.file) return res.status(400).json({ error: 'File wajib diupload' });
    const qris = await decodeQRFromImage(fs.readFileSync(req.file.path));
    // Hapus file temporary
    fs.unlink(req.file.path, () => {});

    // Generate preview QR dengan nominal 10000
    let previewQr = null;
    try {
      const dynamic = generateDynamicQRIS(qris, 10000, 0);
      previewQr = await QRCode.toDataURL(dynamic, { width: 300 });
    } catch (e) {
      previewQr = null;
    }

    res.json({ ok: true, qris, previewQr });
  } catch (err) {
    console.error('❌ qris preview error:', err.message);
    res.status(500).json({ error: 'Gagal decode QR: ' + err.message });
  }
});

export default router;
