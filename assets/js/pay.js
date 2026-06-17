/**
 * Sawerdian - Halaman Pembayaran (full page, dedicated)
 * Load donation by token dari URL, render QR, polling status, redirect ke leaderboard
 */

const API_BASE = (() => {
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'file:') {
    return 'http://localhost:3003';
  }
  return '';
})();

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// State
const state = {
  token: null,
  donation: null,
  dynamicQris: null,
  pollingInterval: null,
  countdownInterval: null,
  redirectTimeout: null,
  pollCount: 0,
  expiresAt: null,
};

// ============================================
// Toast
// ============================================
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const cls = { info: 'alert-info', success: 'alert-success', warning: 'alert-warning', error: 'alert-error' }[type] || 'alert-info';
  const el = document.createElement('div');
  el.className = `alert ${cls} shadow-lg text-sm`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

// ============================================
// Screen switching
// ============================================
function showScreen(id) {
  ['loadingScreen', 'payScreen', 'successScreen'].forEach((sid) => {
    document.getElementById(sid).classList.toggle('hidden', sid !== id);
  });
}

function showError(message) {
  document.getElementById('loadingMsg').textContent = message;
  document.getElementById('loadingMsg').classList.add('text-error', 'font-semibold');
  document.getElementById('backToHome').classList.remove('hidden');
}

// ============================================
// Fetch donation detail
// ============================================
async function loadDonation() {
  state.token = new URLSearchParams(window.location.search).get('token');
  if (!state.token) {
    showError('Token donasi tidak ditemukan di URL.');
    return;
  }

  try {
    const donation = await api(`/api/donations/${state.token}`);

    // Kalau sudah paid saat pertama kali load → langsung ke success
    if (donation.status === 'paid') {
      handlePaid(donation);
      return;
    }

    // Generate ulang QR dari token (kita tidak simpan dynamicQris di DB).
    // Workaround: kalau server tidak return qrImage, kita generate dari server
    //   dengan ambil data donation. Karena POST /api/donations return qrImage,
    //   kita panggil endpoint yang sama tapi kali ini kita butuh data saja.
    // Simpler approach: render placeholder + tunggu user klik "Generate Ulang"
    //   atau gunakan dynamicQris dari localStorage (kalau ada).
    state.donation = donation;

    // Cek localStorage: waktu halaman sawer.js redirect, dia simpan qrImage+dynamicQris
    const cached = readCache(state.token);
    if (cached && cached.qrImage) {
      renderPayScreen(donation, cached.qrImage, cached.dynamicQris);
    } else {
      // Tidak ada cache - tampilkan pesan & minta user balik ke home
      showError('Sesi pembayaran sudah kadaluarsa. Silakan kembali membuat donasi baru.');
      return;
    }

    // Mulai polling
    startPolling();
  } catch (err) {
    showError(err.message || 'Gagal memuat detail donasi.');
  }
}

// ============================================
// Render pay screen
// ============================================
function renderPayScreen(donation, qrImage, dynamicQris) {
  state.dynamicQris = dynamicQris;

  document.getElementById('payAmount').textContent = donation.amountFormatted;

  const donorEl = document.getElementById('payDonor');
  if (donation.donorName) {
    donorEl.textContent = `Dari: ${donation.donorName}`;
  } else {
    donorEl.textContent = '';
  }

  if (donation.uniqueCode && donation.uniqueCode > 0) {
    document.getElementById('payUniqueCodeWrap').classList.remove('hidden');
    document.getElementById('payUniqueCodeVal').textContent = donation.uniqueCode;
  } else {
    document.getElementById('payUniqueCodeWrap').classList.add('hidden');
  }

  document.getElementById('payQrImage').src = qrImage;
  document.getElementById('downloadQrBtn').href = qrImage;

  if (donation.message) {
    document.getElementById('payMessageWrap').classList.remove('hidden');
    document.getElementById('payMessage').textContent = donation.message;
  } else {
    document.getElementById('payMessageWrap').classList.add('hidden');
  }

  // Countdown: kita pakai 24 jam dari createdAt sebagai default expiry display
  // Backend set expiresAt di POST response, kita simpan di cache juga
  const cached = readCache(state.token);
  if (cached && cached.expiresAt) {
    state.expiresAt = new Date(cached.expiresAt);
    startCountdown(state.expiresAt);
  } else {
    // fallback: 24 jam dari createdAt
    state.expiresAt = new Date(new Date(donation.createdAt).getTime() + 24 * 60 * 60 * 1000);
    startCountdown(state.expiresAt);
  }

  showScreen('payScreen');

  // Show polling badge di navbar
  document.getElementById('pollingBadge').classList.remove('hidden');

  // Bind copy button
  document.getElementById('copyQrBtn').addEventListener('click', copyQrString);
}

function startCountdown(expiresAt) {
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  const el = document.getElementById('payCountdown');
  function tick() {
    const diff = expiresAt.getTime() - Date.now();
    if (diff <= 0) {
      el.textContent = '00:00:00';
      el.classList.add('text-error');
      clearInterval(state.countdownInterval);
      return;
    }
    const totalSec = Math.floor(diff / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  }
  tick();
  state.countdownInterval = setInterval(tick, 1000);
}

// ============================================
// Polling status
// ============================================
function startPolling() {
  if (state.pollingInterval) clearInterval(state.pollingInterval);
  state.pollCount = 0;
  // Poll setiap 3 detik
  state.pollingInterval = setInterval(pollStatus, 3000);
}

async function pollStatus() {
  state.pollCount++;
  try {
    const donation = await api(`/api/donations/${state.token}`);
    if (donation.status === 'paid') {
      handlePaid(donation);
    } else if (donation.status === 'expired' || donation.status === 'cancelled') {
      handleExpiredOrCancelled(donation);
    }
    // else pending - lanjut polling
  } catch (err) {
    console.warn('Polling error:', err.message);
    // Stop polling setelah 5x error berturut-turut
    if (state.pollCount > 30) { // 30 * 3s = 90 detik
      showToast('Koneksi terputus. Refresh halaman untuk cek status.', 'warning', 5000);
    }
  }
}

function handlePaid(donation) {
  // Stop semua interval
  if (state.pollingInterval) clearInterval(state.pollingInterval);
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  document.getElementById('pollingBadge').classList.add('hidden');

  // Hapus cache
  clearCache(state.token);

  // Show success
  showScreen('successScreen');

  // Countdown redirect 3..2..1
  let n = 3;
  const counterEl = document.getElementById('redirectCountdown');
  counterEl.textContent = n;
  const tick = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(tick);
      window.location.href = '/leaderboard';
      return;
    }
    counterEl.textContent = n;
  }, 1000);

  // Backup redirect pakai setTimeout
  if (state.redirectTimeout) clearTimeout(state.redirectTimeout);
  state.redirectTimeout = setTimeout(() => {
    window.location.href = '/leaderboard';
  }, 3500);
}

function handleExpiredOrCancelled(donation) {
  if (state.pollingInterval) clearInterval(state.pollingInterval);
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  document.getElementById('pollingBadge').classList.add('hidden');

  showError(`Donasi ini berstatus "${donation.status}". Silakan kembali membuat donasi baru.`);
}

// ============================================
// Copy QR string
// ============================================
async function copyQrString() {
  if (!state.dynamicQris) {
    showToast('QR string tidak tersedia', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(state.dynamicQris);
    showToast('String QR disalin ke clipboard', 'success');
  } catch (e) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = state.dynamicQris;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('String QR disalin', 'success');
    } catch {
      showToast('Gagal menyalin. Salin manual dari download.', 'error');
    }
    document.body.removeChild(ta);
  }
}

// ============================================
// Cache helpers (komunikasi dengan sawer.js via localStorage)
// ============================================
function readCache(token) {
  try {
    const raw = localStorage.getItem(`drp-pay-${token}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Dipakai oleh sawer.js untuk menulis cache saat redirect
window.__drpWritePayCache = function (token, data) {
  try {
    localStorage.setItem(`drp-pay-${token}`, JSON.stringify(data));
  } catch (e) { console.warn('Cache write failed:', e); }
};

function clearCache(token) {
  try { localStorage.removeItem(`drp-pay-${token}`); } catch {}
}

// ============================================
// Init
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('backToHome').addEventListener('click', () => {
    window.location.href = '/';
  });
  loadDonation();
});