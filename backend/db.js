import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL belum diset di .env');
  console.error('   Copy .env.example ke .env dan isi konfigurasi database PostgreSQL.');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Query helper dengan logging di development
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production' && process.env.LOG_QUERIES === '1') {
      console.log('🔍 query', { text: text.substring(0, 80), duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    console.error('❌ Query error:', err.message);
    console.error('   Query:', text);
    throw err;
  }
}

/**
 * Get a client for transaction
 */
export async function getClient() {
  const client = await pool.connect();
  return client;
}

/**
 * Test koneksi database
 */
export async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    return { ok: true, time: res.rows[0].now };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default { pool, query, getClient, testConnection };
