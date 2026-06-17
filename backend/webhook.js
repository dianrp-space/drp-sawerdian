/**
 * Webhook dispatcher
 * Mengirim notifikasi ke Discord / Telegram / Custom URL saat event donasi terjadi
 */
import { query } from './db.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3003';

/**
 * Format payload untuk masing-masing tipe webhook
 */
function formatPayload(type, event, donation, settings) {
  const amount = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(donation.amount);

  const donor = donation.donor_name || 'Anonim';
  const message = donation.message ? `\n💬 ${donation.message}` : '';
  const isPaid = event === 'paid';
  const emoji = isPaid ? '💰' : '🆕';
  const title = isPaid ? 'Saweran Baru Masuk!' : 'Donasi Dibuat';

  const fields = [
    { name: '👤 Nama', value: donor, inline: true },
    { name: '💵 Nominal', value: amount, inline: true },
    { name: '📅 Waktu', value: new Date(donation.created_at).toLocaleString('id-ID'), inline: true },
  ];

  switch (type) {
    case 'discord': {
      return {
        username: 'Sawerdian Bot',
        embeds: [
          {
            title: `${emoji} ${title}`,
            color: isPaid ? 0x6c5ce7 : 0x999999,
            fields,
            description: message.replace(/^💬 /, '') || undefined,
            footer: { text: settings.creator_name || 'DRP Network' },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }

    case 'telegram': {
      const text =
        `${emoji} *${title}*\n\n` +
        `👤 *Nama:* ${donor}\n` +
        `💵 *Nominal:* ${amount}\n` +
        `📅 *Waktu:* ${new Date(donation.created_at).toLocaleString('id-ID')}` +
        message;
      return { text, parse_mode: 'Markdown' };
    }

    case 'custom':
    default: {
      return {
        event,
        donation: {
          id: donation.id,
          amount: donation.amount,
          donor_name: donation.donor_name,
          message: donation.message,
          status: donation.status,
          created_at: donation.created_at,
          paid_at: donation.paid_at,
        },
        creator: {
          name: settings.creator_name || 'DRP Network',
        },
        url: `${BASE_URL}/api/donations/${donation.qr_token}`,
      };
    }
  }
}

/**
 * Dispatch webhooks untuk event tertentu
 * @param {string} event - 'created' | 'paid'
 * @param {object} donation - donation row
 * @param {object} settings - app settings
 */
export async function dispatchWebhooks(event, donation, settings = {}) {
  try {
    const res = await query(
      `SELECT * FROM webhooks WHERE enabled = true AND (trigger_on = $1 OR trigger_on = 'both')`,
      [event]
    );

    if (res.rows.length === 0) return;

    const promises = res.rows.map(async (webhook) => {
      const payload = formatPayload(webhook.type, event, donation, settings);
      const headers = { 'Content-Type': 'application/json' };
      if (webhook.secret) {
        headers['X-Webhook-Secret'] = webhook.secret;
      }

      const start = Date.now();
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        const status = response.status;

        // Log
        await query(
          `INSERT INTO webhook_logs (webhook_id, donation_id, status_code, response) 
           VALUES ($1, $2, $3, $4)`,
          [webhook.id, donation.id, status, text.substring(0, 1000)]
        );

        return { ok: status >= 200 && status < 300, status, duration: Date.now() - start };
      } catch (err) {
        await query(
          `INSERT INTO webhook_logs (webhook_id, donation_id, status_code, error) 
           VALUES ($1, $2, $3, $4)`,
          [webhook.id, donation.id, 0, err.message]
        );
        return { ok: false, error: err.message };
      }
    });

    await Promise.allSettled(promises);
  } catch (err) {
    console.error('❌ Webhook dispatch error:', err.message);
  }
}

/**
 * Test webhook (kirim payload dummy)
 */
export async function testWebhook(webhook) {
  const dummyDonation = {
    id: 0,
    qr_token: 'TEST_TOKEN',
    amount: 10000,
    donor_name: 'Tester',
    message: 'Ini pesan test dari dashboard admin.',
    status: 'paid',
    created_at: new Date().toISOString(),
    paid_at: new Date().toISOString(),
  };
  const dummySettings = { creator_name: 'DRP Network' };

  const payload = formatPayload(webhook.type, 'paid', dummyDonation, dummySettings);
  const headers = { 'Content-Type': 'application/json' };
  if (webhook.secret) {
    headers['X-Webhook-Secret'] = webhook.secret;
  }

  const start = Date.now();
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      duration: Date.now() - start,
      response: text.substring(0, 500),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      duration: Date.now() - start,
    };
  }
}

export default { dispatchWebhooks, testWebhook };
