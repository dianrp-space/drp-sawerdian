/**
 * Database migration script
 * Jalankan: node migrate.js
 *
 * Script ini akan:
 * 1. Create semua tabel yang dibutuhkan
 * 2. Insert default settings (identity, branding, dll)
 * 3. Insert default social_links (opsional)
 */
import dotenv from 'dotenv';
import { pool, query } from './db.js';

dotenv.config();

const SCHEMA = `
-- Settings: key-value store untuk identitas, branding, qris_static, dll
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Donations / Saweran
CREATE TABLE IF NOT EXISTS donations (
  id          SERIAL PRIMARY KEY,
  qr_token    VARCHAR(64) UNIQUE NOT NULL,
  amount      INTEGER NOT NULL,         -- Total yang dibayar (base + unique_code)
  base_amount INTEGER,                  -- Nominal asli yang dipilih user (untuk display)
  unique_code INTEGER DEFAULT 0,        -- Kode unik random 1-999 yang ditambah ke base_amount
  donor_name  VARCHAR(100),
  message     TEXT,
  status      VARCHAR(20) DEFAULT 'pending',
  paid_via    VARCHAR(20) DEFAULT NULL, -- 'webhook' | 'macrodroid' | 'admin'
  paid_via_app VARCHAR(50) DEFAULT NULL,-- 'com.dana' | 'com.gojek' | dll (dari notif Macrodroid)
  ip_address  VARCHAR(64),
  user_agent  TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  paid_at     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_status_paid_at ON donations(status, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_amount_pending ON donations(amount) WHERE status = 'pending';

-- Backfill kolom untuk existing rows (kalau tabel sudah ada tanpa kolom baru)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS base_amount INTEGER;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS unique_code INTEGER DEFAULT 0;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS paid_via_app VARCHAR(50);
ALTER TABLE donations ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false;

-- Komentar pada pesan donasi (maks 100 komentar per pesan, dibatasi di aplikasi)
CREATE TABLE IF NOT EXISTS donation_comments (
  id          SERIAL PRIMARY KEY,
  donation_id INTEGER NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  author_name VARCHAR(100),
  content     TEXT NOT NULL,
  ip_address  VARCHAR(64),
  user_agent  TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_donation_comments_donation_id ON donation_comments(donation_id, created_at ASC);

-- Log request notif dari Macrodroid
CREATE TABLE IF NOT EXISTS macrodroid_logs (
  id             SERIAL PRIMARY KEY,
  donation_id    INTEGER REFERENCES donations(id) ON DELETE SET NULL,
  notif_text     TEXT,
  notif_app      VARCHAR(100),
  notif_title    TEXT,
  status         VARCHAR(50),
  parsed_amount  INTEGER,
  request_query  TEXT,
  request_body   TEXT,
  matched        BOOLEAN DEFAULT false,
  error_message  TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_macrodroid_logs_created_at ON macrodroid_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_macrodroid_logs_donation_id ON macrodroid_logs(donation_id);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  type         VARCHAR(20)  NOT NULL,
  url          TEXT         NOT NULL,
  enabled      BOOLEAN      DEFAULT true,
  trigger_on   VARCHAR(20)  DEFAULT 'paid',
  secret       VARCHAR(100),
  created_at   TIMESTAMP    DEFAULT NOW()
);

-- Webhook logs
CREATE TABLE IF NOT EXISTS webhook_logs (
  id           SERIAL PRIMARY KEY,
  webhook_id   INTEGER REFERENCES webhooks(id) ON DELETE CASCADE,
  donation_id  INTEGER REFERENCES donations(id) ON DELETE SET NULL,
  status_code  INTEGER,
  response     TEXT,
  error        TEXT,
  sent_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_sent_at ON webhook_logs(sent_at DESC);

-- Social links
CREATE TABLE IF NOT EXISTS social_links (
  id            SERIAL PRIMARY KEY,
  platform      VARCHAR(50)  NOT NULL,
  label         VARCHAR(100),
  url           TEXT         NOT NULL,
  icon          VARCHAR(50),
  display_order INTEGER      DEFAULT 0,
  enabled       BOOLEAN      DEFAULT true,
  created_at    TIMESTAMP    DEFAULT NOW()
);

-- Sessions (untuk express-session + connect-pg-simple)
-- connect-pg-simple WAJIB ada PRIMARY KEY di kolom sid
DROP TABLE IF EXISTS session CASCADE;
CREATE TABLE session (
  sid    VARCHAR      NOT NULL COLLATE "default",
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

`;

const DEFAULT_SETTINGS = [
  // Identity
  { key: 'creator_name', value: 'Dian' },
  { key: 'creator_tagline', value: 'Terima kasih sudah mendukung! Dukunganmu sangat berarti 🚀' },
  { key: 'website_url', value: 'https://dianrp.com' },
  { key: 'avatar_url', value: '/images/avatar.png' },
  { key: 'banner_url', value: '' },
  { key: 'primary_color', value: '#6c5ce7' },

  // Donation config
  { key: 'qris_static', value: process.env.QRIS_STATIC || '' },
  { key: 'preset_amounts', value: '5000,10000,20000,50000,100000' },
  { key: 'min_amount', value: '2000' },
  { key: 'max_amount', value: '5000000' },
  { key: 'custom_amount_enabled', value: 'true' },
  { key: 'donor_name_enabled', value: 'true' },
  { key: 'message_enabled', value: 'true' },

  // Expiry display (display only, QRIS sendiri tidak expired)
  { key: 'qr_expiry_hours', value: '24' },

  // Footer
  { key: 'footer_text', value: '© 2026 DRP Network' },
];

async function migrate() {
  console.log('🚀 Starting database migration...\n');

  try {
    // Test koneksi
    console.log('📡 Testing database connection...');
    const res = await query('SELECT NOW() as now, current_database() as db');
    console.log(`   ✅ Connected to: ${res.rows[0].db}`);
    console.log(`   🕐 Server time: ${res.rows[0].now}\n`);

    // Create tables
    console.log('📦 Creating tables...');
    await query(SCHEMA);
    console.log('   ✅ Tables created/verified\n');

    // Insert/update default settings
    console.log('⚙️  Seeding default settings...');
    for (const setting of DEFAULT_SETTINGS) {
      await query(
        `INSERT INTO settings (key, value, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (key) DO NOTHING`,
        [setting.key, setting.value]
      );
    }
    console.log(`   ✅ ${DEFAULT_SETTINGS.length} default settings inserted\n`);

    // List tables
    console.log('📋 Tables in database:');
    const tables = await query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    tables.rows.forEach((row) => console.log(`   - ${row.tablename}`));
    console.log('');

    console.log('✅ Migration completed successfully!\n');
    console.log('Next steps:');
    console.log('  1. Set ADMIN_PASSWORD dan SESSION_SECRET di .env');
    console.log('  2. Set QRIS_STATIC di .env atau upload dari dashboard admin');
    console.log('  3. Run: npm start');
    console.log('  4. Login ke /admin dengan kredensial default\n');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
