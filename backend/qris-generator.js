/**
 * QRIS Dynamic Generator
 * Mengubah QRIS statis menjadi QRIS dinamis dengan nominal yang di-inject
 */
import { calculateCRC } from './qris-crc.js';

/**
 * Parse QRIS string menjadi array of tag { tag, len, val }
 */
function parseTags(str) {
  const tags = [];
  let i = 0;
  while (i < str.length) {
    const tag = str.substr(i, 2);
    const len = parseInt(str.substr(i + 2, 2), 10);
    const val = str.substr(i + 4, len);
    tags.push({ tag, len, val });
    i += 4 + len;
  }
  return tags;
}

/**
 * Generate QRIS dinamis dari string QRIS statis + nominal
 * @param {string} staticQris - String QRIS statis
 * @param {number} amount - Nominal (Rupiah, integer)
 * @param {number} fee - Biaya tambahan (opsional, default 0)
 * @returns {string} String QRIS dinamis dengan CRC
 */
export function generateDynamicQRIS(staticQris, amount, fee = 0) {
  if (!staticQris || typeof staticQris !== 'string') {
    throw new Error('staticQris harus berupa string');
  }
  const totalAmount = Number(amount) + Number(fee || 0);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('amount harus berupa angka positif');
  }

  // 1. Ubah Point of Initiation Method: 010211 (static) → 010212 (dynamic)
  let qris = staticQris;
  if (qris.startsWith('000201')) {
    // Tag 00 (4 char), tag 01 length 02, value 11 → ganti ke 12
    qris = qris.slice(0, 6) + '010212' + qris.slice(12);
  } else {
    // Fallback: regex
    qris = qris.replace(/01(02)11/, '010212');
  }

  // 2. Hapus CRC lama (tag 63 + 4 char CRC) jika ada
  qris = qris.replace(/6304[0-9A-Fa-f]{4}$/, '');

  // 3. Parse tags
  let tags = parseTags(qris);

  // 4. Hapus tag 54 (nominal) jika sudah ada
  tags = tags.filter((t) => t.tag !== '54');

  // 5. Sisipkan tag 54 (nominal transaksi) setelah tag 53
  const nominal = String(totalAmount);
  const nominalTag = { tag: '54', len: nominal.length, val: nominal };
  const idx53 = tags.findIndex((t) => t.tag === '53');
  if (idx53 !== -1) {
    tags.splice(idx53 + 1, 0, nominalTag);
  } else {
    // Fallback: setelah tag 52
    const idx52 = tags.findIndex((t) => t.tag === '52');
    if (idx52 !== -1) {
      tags.splice(idx52 + 1, 0, nominalTag);
    } else {
      tags.push(nominalTag);
    }
  }

  // 6. Gabungkan tags + tag 63 (CRC placeholder)
  const qrisWithAmount =
    tags
      .map((t) => t.tag + t.len.toString().padStart(2, '0') + t.val)
      .join('') + '6304';

  // 7. Hitung CRC
  const crc = calculateCRC(qrisWithAmount);
  return qrisWithAmount + crc;
}

export default { generateDynamicQRIS };
