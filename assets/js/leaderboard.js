/**
 * Sawerdian - Halaman Leaderboard publik
 * Menampilkan nama + nominal sawer (tanpa pesan dan tanpa komentar).
 */

// ============================================
// API
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
  return '';
})();

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

// ============================================
// State
// ============================================
const state = {
  period: 'all',
  items: [],
  config: null,
  stats: null,
};

// ============================================
// Helpers
// ============================================
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = Math.floor((now - date.getTime()) / 1000);

  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatIDR(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(n);
}

// ============================================
// Theme
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
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ============================================
// Load & Render
// ============================================
async function loadAll() {
  try {
    const [config, stats] = await Promise.all([
      api('/api/config'),
      api('/api/leaderboard/stats'),
    ]);
    state.config = config;
    state.stats = stats;
    applyConfig(config);
    applyStats(stats);
    await loadLeaderboard();
  } catch (err) {
    console.error(err);
    showToast('Gagal memuat data', 'error');
  }
}

function applyConfig(config) {
  document.getElementById('creatorName').textContent = config.creator.name;
  document.getElementById('creatorName2').textContent = config.creator.name;
  if (config.creator.avatar) {
    document.getElementById('creatorAvatar').src = config.creator.avatar;
  }
  if (config.creator.primaryColor) {
    document.documentElement.style.setProperty('--drp-primary', config.creator.primaryColor);
  }
  if (config.footer) {
    document.getElementById('footerText').textContent = config.footer;
  }
}

function applyStats(stats) {
  document.getElementById('statDonors').textContent = stats.all.count || 0;
  document.getElementById('statTotal').textContent = stats.all.totalFormatted || 'Rp 0';
  document.getElementById('statMax').textContent = stats.all.maxAmountFormatted || 'Rp 0';
}

async function loadLeaderboard() {
  const list = document.getElementById('leaderboardList');
  const loading = document.getElementById('loadingState');
  const empty = document.getElementById('emptyState');

  loading.classList.remove('hidden');
  list.innerHTML = '';
  empty.classList.add('hidden');

  try {
    const data = await api(`/api/leaderboard?period=${state.period}&limit=50`);
    state.items = data.items;
    renderList();
    document.getElementById('lastUpdate').textContent = `Update: ${new Date().toLocaleTimeString('id-ID')}`;
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Gagal memuat leaderboard', 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

function renderList() {
  const list = document.getElementById('leaderboardList');
  const empty = document.getElementById('emptyState');
  list.innerHTML = '';

  if (!state.items || state.items.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  state.items.forEach((item, i) => {
    const el = document.createElement('div');
    const rankClass =
      item.rank === 1 ? 'rank-1' : item.rank === 2 ? 'rank-2' : item.rank === 3 ? 'rank-3' : '';
    const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`;

    el.className = `card bg-base-100 shadow-sm top-sawer-card animate-fade-in-up`;
    el.style.animationDelay = `${i * 0.05}s`;
    el.innerHTML = `
      <div class="card-body p-3">
        <div class="flex items-center gap-3">
          <div class="text-2xl font-bold w-12 text-center ${rankClass}">${medal}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold truncate">${escapeHtml(item.donorName)}</span>
              <span class="text-xs text-base-content/50">•</span>
              <span class="text-xs text-base-content/50">${timeAgo(item.paidAt)}</span>
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <div class="font-bold text-primary text-lg">${item.amountFormatted}</div>
          </div>
        </div>
      </div>
    `;
    list.appendChild(el);
  });
}

// ============================================
// Events
// ============================================
function attachEvents() {
  // Period tabs
  document.querySelectorAll('[role="tablist"] [role="tab"]').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const period = e.currentTarget.dataset.period;
      if (!period || period === state.period) return;
      state.period = period;
      document.querySelectorAll('[role="tablist"] [role="tab"]').forEach((t) => t.classList.remove('tab-active'));
      e.currentTarget.classList.add('tab-active');
      loadLeaderboard();
    });
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', loadLeaderboard);

  // Auto refresh setiap 30 detik
  setInterval(() => {
    loadLeaderboard();
  }, 30000);
}

// ============================================
// Init
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  attachEvents();
  loadAll();
});