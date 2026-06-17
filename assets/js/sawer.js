/**
 * Sawerdian - Halaman sawer publik
 * Load config, render UI, handle submit donasi
 */

// ============================================
// API base
// ============================================
const API_BASE = (() => {
  const { hostname, protocol } = window.location;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    protocol === 'file:'
  ) {
    return 'http://localhost:3003';
  }
  return ''; // same origin
})();

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ============================================
// State
// ============================================
const state = {
  config: null,
  selectedAmount: null,
  currentDonation: null,
  countdownInterval: null,
};

// ============================================
// Theme handling
// ============================================
function initTheme() {
  const saved = localStorage.getItem('drp-theme');
  const theme = saved || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.checked = theme === 'dark';
    toggle.addEventListener('change', (e) => {
      const newTheme = e.target.checked ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('drp-theme', newTheme);
    });
  }
}

// ============================================
// Toast
// ============================================
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const alertClass = {
    info: 'alert-info',
    success: 'alert-success',
    warning: 'alert-warning',
    error: 'alert-error',
  }[type] || 'alert-info';
  const el = document.createElement('div');
  el.className = `alert ${alertClass} shadow-lg`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ============================================
// Helpers
// ============================================
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

function formatIDR(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(n);
}

function formatShort(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(0) + 'jt';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'rb';
  return n.toString();
}

// ============================================
// Load config & stats
// ============================================
async function loadConfig() {
  try {
    const [config, stats] = await Promise.all([
      api('/api/config'),
      api('/api/leaderboard/stats').catch(() => null),
    ]);
    state.config = config;
    applyConfig(config);
    if (stats) applyStats(stats);
  } catch (err) {
    console.error('Failed to load config:', err);
    showToast('Gagal memuat konfigurasi. Coba refresh halaman.', 'error', 5000);
  }
}

function applyConfig(config) {
  // Creator info
  document.getElementById('creatorName').textContent = config.creator.name;
  document.getElementById('creatorTagline').textContent = config.creator.tagline || '';
  if (config.creator.avatar) {
    document.getElementById('creatorAvatar').src = config.creator.avatar;
  }

  // Primary color CSS variable
  if (config.creator.primaryColor) {
    document.documentElement.style.setProperty('--drp-primary', config.creator.primaryColor);
    // Convert hex to rgb tuple
    const rgb = hexToRgb(config.creator.primaryColor);
    if (rgb) {
      document.documentElement.style.setProperty('--drp-primary-rgb', `${rgb.r},${rgb.g},${rgb.b}`);
    }
  }

  // Banner (optional)
  if (config.creator.banner) {
    const bannerWrap = document.getElementById('bannerWrap');
    const bannerImg = document.getElementById('creatorBanner');
    if (bannerWrap && bannerImg) {
      bannerImg.src = config.creator.banner;
      bannerWrap.classList.remove('hidden');
    }
  }

  // Social links
  const socialWrap = document.getElementById('socialLinks');
  socialWrap.innerHTML = '';
  if (config.creator.website) {
    socialWrap.appendChild(createSocialBtn(config.creator.website, getIcon('website'), 'Website'));
  }
  (config.socials || []).forEach((s) => {
    socialWrap.appendChild(createSocialBtn(s.url, getIcon(s.platform), s.label || s.platform));
  });




  // Footer
  if (config.footer) {
    document.getElementById('footerText').textContent = config.footer;
  }

  // Preset amounts
  renderPresets(config.donation.presets);

  // Toggle optional fields
  if (!config.donation.donorNameEnabled) {
    document.getElementById('donorNameWrap').style.display = 'none';
  }
  if (!config.donation.messageEnabled) {
    document.getElementById('messageWrap').style.display = 'none';
  }

  // Set min/max on custom input
  const customInput = document.getElementById('customAmount');
  customInput.min = config.donation.minAmount;
  customInput.max = config.donation.maxAmount;
}

function applyStats(stats) {
  document.getElementById('statTotal').textContent = stats.all.totalFormatted || 'Rp 0';
  document.getElementById('statMonth').textContent = stats.month.totalFormatted || 'Rp 0';
}

function createSocialBtn(url, iconHTML, label) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = 'tooltip';
  a.setAttribute('data-tip', label);
  // iconHTML adalah HTML brand-icon (bukan string yg perlu di-escape)
  a.innerHTML = iconHTML;
  return a;
}


/**
 * Brand badge untuk social media icon.
 * Return HTML span dengan warna brand + huruf/logo yang recognizable.
 * 36x36 px circle, white text, brand color background.
 */
function getIcon(platform) {
  const p = (platform || '').toLowerCase();
  // Map platform → { text/letter, background (gradient/color) }
  const map = {
    instagram: { text: 'IG', bg: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' },
    youtube:   { text: '▶',  bg: '#FF0000' },
    tiktok:    { text: 'TT', bg: 'linear-gradient(135deg, #25F4EE 0%, #25F4EE 50%, #FE2C55 50%, #FE2C55 100%)' },
    twitter:   { text: '𝕏',  bg: '#000000' },
    x:         { text: '𝕏',  bg: '#000000' },
    telegram:  { text: '✈',  bg: '#26A5E4' },
    facebook:  { text: 'f',  bg: '#1877F2' },
    github:    { text: '',  bg: '#181717' },
    discord:   { text: 'D',  bg: '#5865F2' },
    whatsapp:  { text: 'W',  bg: '#25D366' },
    tiktok:    { text: 'TT', bg: '#010101' },
    youtube_music: { text: '♪', bg: '#FF0000' },
    line:      { text: 'L',  bg: '#00C300' },
    wechat:    { text: 'W',  bg: '#09B83E' },
    linkedin:  { text: 'in', bg: '#0A66C2' },
    pinterest: { text: 'P',  bg: '#E60023' },
    spotify:   { text: '♪',  bg: '#1DB954' },
    twitch:    { text: 'Tv', bg: '#9146FF' },
    website:   { text: 'W',  bg: '#6b7280' },
    other:     { text: '?',  bg: '#6b7280' },
  };
  const b = map[p] || map.other;
  return `<span class="brand-icon" style="background:${b.bg}">${b.text}</span>`;
}


function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

// ============================================
// Preset amounts
// ============================================
function renderPresets(presets) {
  const grid = document.getElementById('presetGrid');
  grid.innerHTML = '';
  presets.forEach((amount) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline btn-primary btn-lg';
    btn.dataset.amount = amount;
    btn.innerHTML = `<span class="font-bold">${formatShort(amount)}</span>`;
    btn.addEventListener('click', () => selectPreset(amount, btn));
    grid.appendChild(btn);
  });
}

function selectPreset(amount, btn) {
  state.selectedAmount = amount;
  document.getElementById('customAmount').value = '';
  // Highlight selected
  document.querySelectorAll('#presetGrid button').forEach((b) => b.classList.remove('btn-primary'));
  document.querySelectorAll('#presetGrid button').forEach((b) => b.classList.add('btn-outline'));
  btn.classList.remove('btn-outline');
  btn.classList.add('btn-primary');
  updateSawerBtn();
}

function clearPresetSelection() {
  state.selectedAmount = null;
  document.querySelectorAll('#presetGrid button').forEach((b) => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-outline');
  });
}

function updateSawerBtn() {
  const btn = document.getElementById('sawerBtn');
  const txt = document.getElementById('btnText');
  const amt = getSelectedAmount();
  if (amt && amt > 0) {
    btn.disabled = false;
    txt.textContent = `Sawer ${formatIDR(amt)}`;
  } else {
    btn.disabled = true;
    txt.textContent = 'Pilih nominal dulu';
  }
}

function getSelectedAmount() {
  if (state.selectedAmount) return state.selectedAmount;
  const custom = parseInt(document.getElementById('customAmount').value, 10);
  return Number.isFinite(custom) && custom > 0 ? custom : 0;
}

// ============================================
// Submit sawer
// ============================================
async function submitSawer() {
  const amount = getSelectedAmount();
  if (!amount || amount <= 0) {
    showToast('Pilih nominal dulu', 'warning');
    return;
  }

  const config = state.config;
  if (amount < config.donation.minAmount) {
    showToast(`Nominal minimum ${formatIDR(config.donation.minAmount)}`, 'warning');
    return;
  }
  if (amount > config.donation.maxAmount) {
    showToast(`Nominal maksimum ${formatIDR(config.donation.maxAmount)}`, 'warning');
    return;
  }

  const donorName = document.getElementById('donorName').value.trim();
  const message = document.getElementById('message').value.trim();

  const btn = document.getElementById('sawerBtn');
  const loading = document.getElementById('btnLoading');
  const txt = document.getElementById('btnText');
  btn.disabled = true;
  loading.classList.remove('hidden');
  txt.textContent = 'Membuat QR...';

  try {
    const data = await api('/api/donations', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        donorName: donorName || null,
        message: message || null,
      }),
    });

    state.currentDonation = data;

    // Simpan data QR ke localStorage agar halaman /pay bisa render QR-nya
    // (QR image dan dynamic string QR tidak disimpan di DB)
    try {
      localStorage.setItem(`drp-pay-${data.qrToken}`, JSON.stringify({
        qrImage: data.qrImage,
        dynamicQris: data.dynamicQris,
        expiresAt: data.expiresAt,
        amountFormatted: data.amountFormatted,
        uniqueCode: data.uniqueCode,
        donorName: data.donorName,
        message: data.message,
      }));
    } catch (e) {
      console.warn('Gagal menyimpan QR cache:', e);
    }

    // Redirect ke halaman pembayaran dedicated (full page, bukan modal)
    // supaya user tidak bisa accidental close modal & batal transaksi
    window.location.href = `/pay?token=${data.qrToken}`;
  } catch (err) {
    console.error('Sawer error:', err);
    showToast(err.message || 'Gagal membuat saweran', 'error', 5000);
  } finally {
    loading.classList.add('hidden');
    updateSawerBtn();
  }
}

// ============================================
// Event listeners
// ============================================
function attachEvents() {
  // Custom amount
  document.getElementById('customAmount').addEventListener('input', (e) => {
    if (e.target.value) clearPresetSelection();
    updateSawerBtn();
  });

  // Sawer button - submit dan redirect ke /pay page dedicated
  document.getElementById('sawerBtn').addEventListener('click', submitSawer);
}

// ============================================
// Init
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  attachEvents();
  loadConfig();
});
