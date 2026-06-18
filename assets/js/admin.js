/**
 * Sawerdian - Admin Dashboard
 * Login, tab navigation, CRUD, file upload, QR preview
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
  return '';
})();

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
  loggedIn: false,
  currentTab: 'overview',
  admin: null,
  data: {
    donations: { items: [], total: 0, page: 1 },
  },
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

function formatIDR(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(n);
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadge(status) {
  const map = {
    pending: { class: 'badge-warning', label: 'Pending' },
    paid: { class: 'badge-success', label: 'Paid' },
    expired: { class: 'badge-error', label: 'Expired' },
    cancelled: { class: 'badge-neutral', label: 'Cancelled' },
  };
  const m = map[status] || { class: 'badge-neutral', label: status };
  return `<span class="badge ${m.class} badge-sm">${m.label}</span>`;
}

/**
 * Brand badge untuk social media icon (mirror of sawer.js).
 * Return HTML span dengan warna brand + huruf yang recognizable.
 */
function getBrandBadge(platform) {
  const p = (platform || '').toLowerCase();
  const map = {
    instagram: { text: 'IG', bg: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' },
    youtube:   { text: '▶',  bg: '#FF0000' },
    tiktok:    { text: 'TT', bg: 'linear-gradient(135deg, #25F4EE 0%, #25F4EE 50%, #FE2C55 50%, #FE2C55 100%)' },
    twitter:   { text: '𝕏',  bg: '#000000' },
    x:         { text: '𝕏',  bg: '#000000' },
    telegram:  { text: '✈',  bg: '#26A5E4' },
    facebook:  { text: 'f',  bg: '#1877F2' },
    github:    { text: 'GH', bg: '#181717' },
    discord:   { text: 'D',  bg: '#5865F2' },
    whatsapp:  { text: 'WA', bg: '#25D366' },
    line:      { text: 'L',  bg: '#00C300' },
    linkedin:  { text: 'in', bg: '#0A66C2' },
    pinterest: { text: 'P',  bg: '#E60023' },
    spotify:   { text: '♪',  bg: '#1DB954' },
    twitch:    { text: 'Tv', bg: '#9146FF' },
    website:   { text: '🌐', bg: '#6b7280' },
    other:     { text: '?',  bg: '#6b7280' },
  };
  const b = map[p] || map.other;
  return `<span class="brand-icon" style="background:${b.bg}">${b.text}</span>`;
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
  el.className = `alert ${alertClass} shadow-lg text-sm`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ============================================
// Modal helper
// ============================================
function showModal(content) {
  const modal = document.getElementById('modal');
  modal.innerHTML = content;
  modal.showModal();

  // Attach close handler ke semua button dengan data-modal-close
  modal.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => modal.close());
  });
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.close();
  modal.innerHTML = '';
}


// ============================================
// LOGIN
// ============================================
async function checkSession() {
  try {
    const data = await api('/api/admin/me');
    if (data.ok) {
      state.loggedIn = true;
      state.admin = data;
      showDashboard();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboardScreen').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.remove('hidden');
  if (state.admin) {
    document.getElementById('adminUsername').textContent = state.admin.username;
  }
  loadTab(state.currentTab);
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');

  const btn = document.getElementById('loginBtn');
  const loading = document.getElementById('loginLoading');
  const txt = document.getElementById('loginBtnText');
  btn.disabled = true;
  loading.classList.remove('hidden');
  txt.textContent = 'Login...';

  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    state.loggedIn = true;
    state.admin = { username: data.username };
    showDashboard();
    showToast(`Selamat datang, ${data.username}!`, 'success');
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    loading.classList.add('hidden');
    txt.textContent = 'Login';
  }
}

async function handleLogout() {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch {}
  state.loggedIn = false;
  state.admin = null;
  showLogin();
  showToast('Logout berhasil', 'info');
}

// ============================================
// TAB NAVIGATION
// ============================================
function attachTabEvents() {
  document.querySelectorAll('#sidebarMenu a[data-tab]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = e.currentTarget.dataset.tab;
      document.querySelectorAll('#sidebarMenu a').forEach((x) => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.currentTab = tab;
      // Close drawer di mobile
      document.getElementById('dash-drawer').checked = false;
      loadTab(tab);
    });
  });
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
}

async function loadTab(tab) {
  const container = document.getElementById('tabContent');
  container.innerHTML = `<div class="flex items-center justify-center py-20"><span class="loading loading-spinner loading-lg"></span></div>`;

  try {
    switch (tab) {
      case 'overview':
        await renderOverview();
        break;
      case 'donations':
        await renderDonations();
        break;
      case 'branding':
        await renderBranding();
        break;
      case 'identity':
        await renderIdentity();
        break;
      case 'socials':
        await renderSocials();
        break;
      case 'webhooks':
        await renderWebhooks();
        break;
      case 'settings':
        await renderSettings();
        break;
    }
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

// ============================================
// TAB: OVERVIEW
// ============================================
async function renderOverview() {
  const [data, config] = await Promise.all([
    api('/api/admin/dashboard'),
    api('/api/config'),
  ]);

  // Update sidebar
  document.getElementById('sidebarCreatorName').textContent = config.creator.name;
  if (config.creator.avatar) {
    document.getElementById('sidebarAvatar').src = config.creator.avatar;
  }

  const maxDay = Math.max(...data.daily.map((d) => d.total), 1);

  document.getElementById('tabContent').innerHTML = `
    <div class="space-y-4">
      <!-- Stats cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="stat bg-base-100 rounded-box shadow-md border-2 border-base-300">
          <div class="stat-title text-xs font-bold text-base-content/70">Total Semua</div>
          <div class="stat-value text-xl text-base-content">${formatIDR(data.all.total)}</div>
          <div class="stat-desc font-semibold text-base-content/60">${data.all.count} sawer</div>
        </div>
        <div class="stat bg-base-100 rounded-box shadow-md border-2 border-base-300">
          <div class="stat-title text-xs font-bold text-base-content/70">Hari Ini</div>
          <div class="stat-value text-xl text-primary">${formatIDR(data.today.total)}</div>
          <div class="stat-desc font-semibold text-base-content/60">${data.today.count} sawer</div>
        </div>
        <div class="stat bg-base-100 rounded-box shadow-md border-2 border-base-300">
          <div class="stat-title text-xs font-bold text-base-content/70">Bulan Ini</div>
          <div class="stat-value text-xl text-secondary">${formatIDR(data.month.total)}</div>
          <div class="stat-desc font-semibold text-base-content/60">${data.month.count} sawer</div>
        </div>
        <div class="stat bg-base-100 rounded-box shadow-md border-2 border-base-300">
          <div class="stat-title text-xs font-bold text-base-content/70">Pending</div>
          <div class="stat-value text-xl text-warning">${data.pending.count}</div>
          <div class="stat-desc font-semibold text-base-content/60">belum dikonfirmasi</div>
        </div>
      </div>

      <!-- 7-day chart -->
      <div class="card bg-base-100 shadow-md border-2 border-base-300">
        <div class="card-body p-4">
          <h3 class="font-bold text-sm text-base-content">7 Hari Terakhir</h3>
          <div class="flex items-end gap-1 h-32 mt-2">
            ${data.daily.length === 0 ? '<p class="text-sm text-base-content/50 m-auto font-medium">Belum ada data</p>' : data.daily.map((d) => {
              // Pastikan maxDay dihitung berdasarkan 'total' max dari backend
              const safeMaxDay = maxDay > 0 ? maxDay : 1;
              const h = Math.max((d.total / safeMaxDay) * 100, 4);
              const dayLabel = new Date(d.day).toLocaleDateString('id-ID', { weekday: 'short' });
              return `
                <div class="flex-1 flex flex-col items-center gap-1" title="${formatIDR(d.total)} - ${d.count} sawer">
                  <div class="w-full bg-primary/80 rounded-t min-h-[4px]" style="height: ${h}%"></div>
                  <span class="text-[10px] text-base-content/70 font-bold">${dayLabel}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Top 5 -->
      <div class="card bg-base-100 shadow-md border-2 border-base-300">
        <div class="card-body p-4">
          <h3 class="font-bold text-sm text-base-content">🏆 Top 5 Sawer</h3>
          <div class="space-y-2 mt-2">
            ${data.top.length === 0 ? '<p class="text-sm text-base-content/50 font-medium">Belum ada data</p>' : data.top.map((t, i) => {
              const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || `#${i + 1}`;
              return `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors">
                  <span class="text-xl">${medal}</span>
                  <div class="flex-1">
                    <p class="font-bold text-sm text-base-content">${escapeHtml(t.donorName)}</p>
                    <p class="text-xs text-base-content/60 font-medium">${formatDate(t.paidAt)}</p>
                  </div>
                  <p class="font-bold text-primary">${t.amountFormatted}</p>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================
// TAB: DONATIONS
// ============================================
async function renderDonations(page = 1) {
  // Ambil nilai filter saat ini jika ada, atau gunakan yang tersimpan di state
  const filterStatusEl = document.getElementById('filterStatus');
  const filterPeriodEl = document.getElementById('filterPeriod');
  const filterSearchEl = document.getElementById('filterSearch');
  
  const currentStatus = filterStatusEl ? filterStatusEl.value : (state.donationsFilter?.status || '');
  const currentPeriod = filterPeriodEl ? filterPeriodEl.value : (state.donationsFilter?.period || '');
  const currentSearch = filterSearchEl ? filterSearchEl.value : (state.donationsFilter?.search || '');
  
  // Simpan filter ke state
  state.donationsFilter = { status: currentStatus, period: currentPeriod, search: currentSearch };

  // Buat query string
  const queryParams = new URLSearchParams({ page, limit: 20 });
  if (currentStatus) queryParams.append('status', currentStatus);
  if (currentPeriod) queryParams.append('period', currentPeriod);
  if (currentSearch) queryParams.append('q', currentSearch);

  const data = await api(`/api/admin/donations?${queryParams.toString()}`);
  state.data.donations = data;

  document.getElementById('tabContent').innerHTML = `
    <div class="space-y-3">
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <h2 class="text-xl font-bold">💰 Donations</h2>
        <div class="flex gap-2">
          <div id="batchActionsWrap" class="hidden flex gap-1 items-center bg-base-200 p-1 px-2 border-2 border-black shadow-[2px_2px_0_0_#000]">
            <span class="text-xs font-bold mr-1"><span id="selectedCount">0</span> dipilih:</span>
            <button id="batchPaidBtn" class="btn btn-xs btn-success" title="Tandai Paid">✓</button>
            <button id="batchCancelBtn" class="btn btn-xs btn-warning" title="Batalkan">✕</button>
            <button id="batchExpiredBtn" class="btn btn-xs btn-ghost" title="Tandai Expired">⏰</button>
            <button id="batchDeleteBtn" class="btn btn-xs btn-error" title="Hapus">🗑</button>
          </div>
          <a href="/api/admin/donations/export.csv?${queryParams.toString()}" class="btn btn-sm btn-outline" target="_blank">⬇ Export CSV</a>
        </div>
      </div>

      <!-- Filters -->
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-3">
          <div class="flex flex-wrap gap-2">
            <select id="filterStatus" class="select select-bordered select-sm">
              <option value="" ${currentStatus === '' ? 'selected' : ''}>Semua status</option>
              <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="paid" ${currentStatus === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="expired" ${currentStatus === 'expired' ? 'selected' : ''}>Expired</option>
              <option value="cancelled" ${currentStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
            <select id="filterPeriod" class="select select-bordered select-sm">
              <option value="" ${currentPeriod === '' ? 'selected' : ''}>Semua waktu</option>
              <option value="today" ${currentPeriod === 'today' ? 'selected' : ''}>Hari ini</option>
              <option value="month" ${currentPeriod === 'month' ? 'selected' : ''}>Bulan ini</option>
            </select>
            <input type="text" id="filterSearch" class="input input-bordered input-sm flex-1 min-w-[150px]" placeholder="Cari nama, pesan, token..." value="${escapeHtml(currentSearch)}" />
            <button id="applyFilter" class="btn btn-sm btn-primary">Cari</button>
          </div>
        </div>
      </div>

      <!-- Tabel -->
      <div class="card bg-base-100 shadow-sm">
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th><input type="checkbox" class="checkbox checkbox-sm" id="selectAllDonations" title="Pilih Semua" /></th>
                <th>#</th>
                <th>Nama / Donor</th>
                <th>Nominal</th>
                <th>Pesan</th>
                <th>Status</th>
                <th>Waktu</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody id="donationsTbody">
              ${renderDonationsRows(data.items)}
            </tbody>
          </table>
        </div>
        <div class="card-body p-3 border-t border-base-300 flex-row items-center justify-between">
          <span class="text-sm text-base-content/60">Total: <strong>${data.total}</strong> donasi (${formatIDR(data.totalAmount)})</span>
          <div class="join">
            <button class="join-item btn btn-sm" id="prevPage" ${page <= 1 ? 'disabled' : ''}>«</button>
            <button class="join-item btn btn-sm">Halaman ${page}</button>
            <button class="join-item btn btn-sm" id="nextPage" ${data.items.length < 20 ? 'disabled' : ''}>»</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Event handlers
  document.getElementById('applyFilter').addEventListener('click', () => renderDonations(1));
  document.getElementById('filterSearch').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') renderDonations(1);
  });
  document.getElementById('prevPage').addEventListener('click', () => {
    if (page > 1) renderDonations(page - 1);
  });
  document.getElementById('nextPage').addEventListener('click', () => {
    if (data.items.length >= 20) renderDonations(page + 1);
  });
  document.querySelectorAll('[data-action="mark-paid"]').forEach((b) => {
    b.addEventListener('click', () => updateDonationStatus(b.dataset.id, 'paid'));
  });
  document.querySelectorAll('[data-action="mark-expired"]').forEach((b) => {
    b.addEventListener('click', () => updateDonationStatus(b.dataset.id, 'expired'));
  });
  document.querySelectorAll('[data-action="cancel"]').forEach((b) => {
    b.addEventListener('click', () => updateDonationStatus(b.dataset.id, 'cancelled'));
  });
  document.querySelectorAll('[data-action="delete"]').forEach((b) => {
    b.addEventListener('click', () => deleteDonation(b.dataset.id));
  });

  // Batch delete & status update logic
  const selectAll = document.getElementById('selectAllDonations');
  const rowCheckboxes = document.querySelectorAll('.row-checkbox');
  const batchActionsWrap = document.getElementById('batchActionsWrap');
  const batchPaidBtn = document.getElementById('batchPaidBtn');
  const batchCancelBtn = document.getElementById('batchCancelBtn');
  const batchExpiredBtn = document.getElementById('batchExpiredBtn');
  const batchDeleteBtn = document.getElementById('batchDeleteBtn');
  const selectedCount = document.getElementById('selectedCount');

  function updateBatchDeleteUI() {
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    const count = checkedBoxes.length;
    
    if (selectedCount) selectedCount.textContent = count;
    
    if (batchActionsWrap) {
      if (count > 0) {
        batchActionsWrap.classList.remove('hidden');
      } else {
        batchActionsWrap.classList.add('hidden');
      }
    }
    
    if (selectAll && rowCheckboxes.length > 0) {
      selectAll.checked = count === rowCheckboxes.length;
    }
  }

  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      rowCheckboxes.forEach(cb => {
        cb.checked = e.target.checked;
      });
      updateBatchDeleteUI();
    });
  }

  rowCheckboxes.forEach(cb => {
    cb.addEventListener('change', updateBatchDeleteUI);
  });

  async function handleBatchStatus(status, btnElement, btnText) {
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10));
    
    if (ids.length === 0) return;
    if (!confirm(`Ubah status ${ids.length} donasi menjadi "${status}"?`)) return;
    
    btnElement.disabled = true;
    btnElement.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
    
    try {
      await api('/api/admin/donations/batch/status', {
        method: 'PATCH',
        body: JSON.stringify({ ids, status }),
      });
      showToast(`Status ${ids.length} donasi diubah ke ${status}`, 'success');
      renderDonations(state.data.donations.page);
    } catch (err) {
      showToast(err.message, 'error');
      btnElement.disabled = false;
      btnElement.innerHTML = btnText;
    }
  }

  if (batchPaidBtn) batchPaidBtn.addEventListener('click', () => handleBatchStatus('paid', batchPaidBtn, '✓'));
  if (batchCancelBtn) batchCancelBtn.addEventListener('click', () => handleBatchStatus('cancelled', batchCancelBtn, '✕'));
  if (batchExpiredBtn) batchExpiredBtn.addEventListener('click', () => handleBatchStatus('expired', batchExpiredBtn, '⏰'));

  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
      const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10));
      
      if (ids.length === 0) return;
      if (!confirm(`Hapus ${ids.length} donasi terpilih secara permanen?`)) return;
      
      batchDeleteBtn.disabled = true;
      batchDeleteBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
      
      try {
        await api('/api/admin/donations/batch', {
          method: 'DELETE',
          body: JSON.stringify({ ids }),
        });
        showToast(`${ids.length} donasi berhasil dihapus`, 'success');
        renderDonations(state.data.donations.page);
      } catch (err) {
        showToast(err.message, 'error');
        batchDeleteBtn.disabled = false;
        batchDeleteBtn.innerHTML = '🗑';
      }
    });
  }

}

function renderDonationsRows(items) {
  if (items.length === 0) {
    return '<tr><td colspan="8" class="text-center py-8 text-base-content/50">Belum ada donasi</td></tr>';
  }
  return items.map((d) => `
    <tr>
      <td><input type="checkbox" class="checkbox checkbox-sm row-checkbox" value="${d.id}" /></td>
      <td class="text-xs text-base-content/50">#${d.id}</td>
      <td>
        <div class="font-semibold text-sm">${escapeHtml(d.donor_name || 'Anonim')}</div>
        <div class="text-xs text-base-content/40">${d.paid_via ? 'via ' + d.paid_via : ''}</div>
      </td>
      <td class="font-semibold">${formatIDR(d.amount)}</td>
      <td class="text-xs max-w-xs truncate" title="${escapeHtml(d.message || '')}">${escapeHtml(d.message || '-')}</td>
      <td>${statusBadge(d.status)}</td>
      <td class="text-xs">${formatDate(d.created_at)}</td>
      <td>
        <div class="flex gap-1 flex-wrap">
          ${d.status !== 'paid' ? `<button class="btn btn-xs btn-success" data-action="mark-paid" data-id="${d.id}" title="Tandai Paid">✓ Paid</button>` : '<span class="badge badge-success badge-sm">✓ Paid</span>'}
          ${d.status !== 'cancelled' ? `<button class="btn btn-xs btn-warning" data-action="cancel" data-id="${d.id}" title="Batalkan">✕ Cancel</button>` : '<span class="badge badge-neutral badge-sm">Cancelled</span>'}
          ${d.status === 'pending' ? `<button class="btn btn-xs btn-ghost" data-action="mark-expired" data-id="${d.id}" title="Tandai Expired">⏰ Expired</button>` : ''}
          <button class="btn btn-xs btn-ghost text-error" data-action="delete" data-id="${d.id}" title="Hapus">🗑</button>
        </div>
      </td>

    </tr>
  `).join('');
}

async function updateDonationStatus(id, status) {
  if (!confirm(`Ubah status donasi ini menjadi "${status}"?`)) return;
  try {
    await api(`/api/admin/donations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast(`Status diubah ke ${status}`, 'success');
    renderDonations(state.data.donations.page);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteDonation(id) {
  if (!confirm('Hapus donasi ini permanen?')) return;
  try {
    await api(`/api/admin/donations/${id}`, { method: 'DELETE' });
    showToast('Donasi dihapus', 'success');
    renderDonations(state.data.donations.page);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================
// TAB: BRANDING
// ============================================
async function renderBranding() {
  const config = await api('/api/config');

  document.getElementById('tabContent').innerHTML = `
    <div class="space-y-3">
      <h2 class="text-xl font-bold">🎨 Branding</h2>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <h3 class="font-bold text-sm">Logo / Avatar</h3>
          <p class="text-xs text-base-content/60 mb-3">Format: JPG, PNG, WEBP. Maks 2MB.</p>
          <div class="flex items-center gap-3">
            <div class="avatar">
              <div class="w-20 rounded-full ring ring-primary ring-offset-base-100 ring-offset-1">
                <img id="currentLogo" src="${config.creator.avatar}" alt="Logo" />
              </div>
            </div>
            <div class="flex-1">
              <input type="file" id="logoInput" accept="image/*" class="file-input file-input-bordered file-input-sm w-full" />
              <div class="flex gap-2 mt-2">
                <button id="uploadLogoBtn" class="btn btn-sm btn-primary">Upload Logo</button>
                <button id="resetLogoBtn" class="btn btn-sm btn-ghost">Reset ke Default</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <h3 class="font-bold text-sm">Banner</h3>
          <p class="text-xs text-base-content/60 mb-3">Banner opsional. Akan tampil di halaman sawer.</p>
          <div class="space-y-2">
            ${config.creator.banner ? `<img src="${config.creator.banner}" class="w-full h-32 object-cover rounded-lg" alt="Banner" />` : '<p class="text-sm text-base-content/50">Belum ada banner</p>'}
            <input type="file" id="bannerInput" accept="image/*" class="file-input file-input-bordered file-input-sm w-full" />
            <div class="flex gap-2">
              <button id="uploadBannerBtn" class="btn btn-sm btn-primary">Upload Banner</button>
              ${config.creator.banner ? '<button id="resetBannerBtn" class="btn btn-sm btn-ghost">Hapus Banner</button>' : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <h3 class="font-bold text-sm">Warna Primer</h3>
          <p class="text-xs text-base-content/60 mb-3">Warna utama untuk tombol dan accent. Pakai hex (contoh: #6c5ce7).</p>
          <div class="flex items-center gap-2">
            <input type="color" id="primaryColor" value="${config.creator.primaryColor}" class="w-12 h-10 rounded cursor-pointer" />
            <input type="text" id="primaryColorHex" value="${config.creator.primaryColor}" class="input input-bordered input-sm flex-1" />
            <button id="saveColorBtn" class="btn btn-sm btn-primary">Simpan</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Logo upload
  document.getElementById('uploadLogoBtn').addEventListener('click', async () => {
    const file = document.getElementById('logoInput').files[0];
    if (!file) return showToast('Pilih file dulu', 'warning');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api('/api/admin/branding/logo', { method: 'POST', body: formData });
      showToast('Logo berhasil diupload', 'success');
      document.getElementById('currentLogo').src = res.url + '?t=' + Date.now();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
  document.getElementById('resetLogoBtn').addEventListener('click', async () => {
    if (!confirm('Reset logo ke default?')) return;
    await api('/api/admin/branding/logo', { method: 'DELETE' });
    showToast('Logo direset', 'success');
    renderBranding();
  });

  // Banner upload
  document.getElementById('uploadBannerBtn')?.addEventListener('click', async () => {
    const file = document.getElementById('bannerInput').files[0];
    if (!file) return showToast('Pilih file dulu', 'warning');
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api('/api/admin/branding/banner', { method: 'POST', body: formData });
      showToast('Banner berhasil diupload', 'success');
      renderBranding();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
  document.getElementById('resetBannerBtn')?.addEventListener('click', async () => {
    if (!confirm('Hapus banner?')) return;
    await api('/api/admin/branding/banner', { method: 'DELETE' });
    showToast('Banner dihapus', 'success');
    renderBranding();
  });

  // Color
  const colorInput = document.getElementById('primaryColor');
  const hexInput = document.getElementById('primaryColorHex');
  colorInput.addEventListener('input', (e) => {
    hexInput.value = e.target.value;
  });
  hexInput.addEventListener('input', (e) => {
    if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
      colorInput.value = e.target.value;
    }
  });
  document.getElementById('saveColorBtn').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ primary_color: hexInput.value }),
      });
      showToast('Warna disimpan', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ============================================
// TAB: IDENTITY
// ============================================
async function renderIdentity() {
  const config = await api('/api/config');

  document.getElementById('tabContent').innerHTML = `
    <div class="space-y-3">
      <h2 class="text-xl font-bold">👤 Identity</h2>
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 space-y-3">
          <label class="floating-label">
            <span>Nama Kreator</span>
            <input type="text" id="id-name" class="input input-bordered w-full" value="${escapeHtml(config.creator.name)}" />
          </label>
          <label class="floating-label">
            <span>Pesan Sambutan</span>
            <textarea id="id-tagline" class="textarea textarea-bordered w-full" rows="2">${escapeHtml(config.creator.tagline)}</textarea>
          </label>
          <label class="floating-label">
            <span>Website URL</span>
            <input type="url" id="id-website" class="input input-bordered w-full" value="${escapeHtml(config.creator.website)}" />
          </label>
          <label class="floating-label">
            <span>Footer Text</span>
            <input type="text" id="id-footer" class="input input-bordered w-full" value="${escapeHtml(config.footer)}" />
          </label>
          <button id="saveIdentityBtn" class="btn btn-primary">Simpan Identity</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('saveIdentityBtn').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          creator_name: document.getElementById('id-name').value,
          creator_tagline: document.getElementById('id-tagline').value,
          website_url: document.getElementById('id-website').value,
          footer_text: document.getElementById('id-footer').value,
        }),
      });
      showToast('Identity disimpan', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ============================================
// TAB: SOCIALS
// ============================================
async function renderSocials() {
  const socials = await api('/api/admin/socials');

  document.getElementById('tabContent').innerHTML = `
    <div class="space-y-3">
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-bold">🔗 Social Links</h2>
        <button id="addSocialBtn" class="btn btn-sm btn-primary">+ Tambah</button>
      </div>
      <div class="card bg-base-100 shadow-sm">
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr><th>Order</th><th>Platform</th><th>Label</th><th>URL</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              ${socials.length === 0 ? '<tr><td colspan="6" class="text-center py-8 text-base-content/50">Belum ada social link</td></tr>' : socials.map(s => `
                <tr>
                  <td>${s.display_order}</td>
                  <td>${escapeHtml(s.platform)}</td>
                  <td>${escapeHtml(s.label || '-')}</td>
                  <td class="text-xs max-w-xs truncate"><a href="${escapeHtml(s.url)}" target="_blank" class="link">${escapeHtml(s.url)}</a></td>
                  <td><span class="badge ${s.enabled ? 'badge-success' : 'badge-neutral'} badge-sm">${s.enabled ? 'Aktif' : 'Off'}</span></td>
                  <td>
                    <button class="btn btn-xs btn-ghost" data-edit-social="${escapeHtml(encodeURIComponent(JSON.stringify(s)))}">Edit</button>
                    <button class="btn btn-xs btn-ghost text-error" data-del-social="${s.id}">🗑</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('addSocialBtn').addEventListener('click', () => openSocialModal());
  document.querySelectorAll('[data-edit-social]').forEach((b) => {
    b.addEventListener('click', () => openSocialModal(JSON.parse(decodeURIComponent(b.dataset.editSocial))));
  });
  document.querySelectorAll('[data-del-social]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Hapus social link ini?')) return;
      try {
        await api(`/api/admin/socials/${b.dataset.delSocial}`, { method: 'DELETE' });
        showToast('Dihapus', 'success');
        renderSocials();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}

function openSocialModal(data = null) {
  const isEdit = !!data;
  showModal(`
    <div class="modal-box">
      <h3 class="font-bold text-lg">${isEdit ? 'Edit' : 'Tambah'} Social Link</h3>
      <form id="socialForm" class="space-y-3 mt-4">
        <label class="floating-label">
          <span>Platform</span>
          <input type="text" id="s-platform" class="input input-bordered w-full" required list="platform-list" value="${data?.platform || ''}" />
        </label>
        <datalist id="platform-list">
          <option value="instagram"><option value="youtube"><option value="tiktok"><option value="twitter">
          <option value="telegram"><option value="facebook"><option value="github"><option value="discord">
          <option value="website"><option value="other">
        </datalist>
        <label class="floating-label">
          <span>Label (opsional)</span>
          <input type="text" id="s-label" class="input input-bordered w-full" value="${data?.label || ''}" />
        </label>
        <label class="floating-label">
          <span>URL</span>
          <input type="url" id="s-url" class="input input-bordered w-full" required value="${data?.url || ''}" />
        </label>
        <label class="floating-label">
          <span>Display Order</span>
          <input type="number" id="s-order" class="input input-bordered w-full" value="${data?.display_order || 0}" />
        </label>
        <label class="label cursor-pointer justify-start gap-2">
          <input type="checkbox" id="s-enabled" class="toggle toggle-primary" ${data?.enabled !== false ? 'checked' : ''} />
          <span>Aktif</span>
        </label>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" data-modal-close>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  `);
  document.getElementById('socialForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      platform: document.getElementById('s-platform').value,
      label: document.getElementById('s-label').value,
      url: document.getElementById('s-url').value,
      display_order: parseInt(document.getElementById('s-order').value, 10) || 0,
      enabled: document.getElementById('s-enabled').checked,
    };
    try {
      if (isEdit) {
        await api(`/api/admin/socials/${data.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/admin/socials', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal();
      showToast('Social link disimpan', 'success');
      renderSocials();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ============================================
// TAB: WEBHOOKS
// ============================================
async function renderWebhooks() {
  const [webhooks, logs] = await Promise.all([
    api('/api/admin/webhooks'),
    api('/api/admin/webhook-logs?limit=20'),
  ]);

  document.getElementById('tabContent').innerHTML = `
    <div class="space-y-3">
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-bold">🔔 Webhooks</h2>
        <button id="addWebhookBtn" class="btn btn-sm btn-primary">+ Tambah Webhook</button>
      </div>
      <p class="text-xs text-base-content/60">Webhook akan mengirim notifikasi ke Discord/Telegram/Custom URL saat ada donasi.</p>

      <div class="space-y-2">
        ${webhooks.length === 0 ? '<div class="alert">Belum ada webhook. Tambahkan webhook untuk mulai menerima notifikasi.</div>' : webhooks.map(w => `
          <div class="card bg-base-100 shadow-sm">
            <div class="card-body p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold">${escapeHtml(w.name)}</span>
                    <span class="badge badge-sm">${w.type}</span>
                    <span class="badge badge-sm ${w.enabled ? 'badge-success' : 'badge-neutral'}">${w.enabled ? 'Aktif' : 'Off'}</span>
                    <span class="badge badge-sm badge-outline">trigger: ${w.trigger_on}</span>
                  </div>
                  <p class="text-xs text-base-content/60 truncate mt-1">${escapeHtml(w.url)}</p>
                </div>
                <div class="flex gap-1 flex-shrink-0">
                  <button class="btn btn-xs btn-ghost" data-test-webhook="${w.id}">🧪 Test</button>
                  <button class="btn btn-xs btn-ghost" data-edit-webhook="${escapeHtml(encodeURIComponent(JSON.stringify(w)))}">✏</button>
                  <button class="btn btn-xs btn-ghost text-error" data-del-webhook="${w.id}">🗑</button>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      ${logs.length > 0 ? `
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body p-4">
            <h3 class="font-bold text-sm">📜 Log Terakhir</h3>
            <div class="space-y-1 mt-2 text-xs">
              ${logs.map(l => `
                <div class="flex items-center gap-2 p-1 hover:bg-base-200 rounded">
                  <span class="badge badge-xs ${l.status_code >= 200 && l.status_code < 300 ? 'badge-success' : 'badge-error'}">${l.status_code || 'ERR'}</span>
                  <span class="font-semibold">${escapeHtml(l.webhook_name || '?')}</span>
                  <span class="text-base-content/50">${formatDate(l.sent_at)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('addWebhookBtn').addEventListener('click', () => openWebhookModal());
  document.querySelectorAll('[data-edit-webhook]').forEach((b) => {
    b.addEventListener('click', () => openWebhookModal(JSON.parse(decodeURIComponent(b.dataset.editWebhook))));
  });
  document.querySelectorAll('[data-del-webhook]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Hapus webhook ini?')) return;
      try {
        await api(`/api/admin/webhooks/${b.dataset.delWebhook}`, { method: 'DELETE' });
        showToast('Dihapus', 'success');
        renderWebhooks();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
  document.querySelectorAll('[data-test-webhook]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = '⏳';
      try {
        const res = await api(`/api/admin/webhooks/${b.dataset.testWebhook}/test`, { method: 'POST' });
        if (res.ok) {
          showToast(`✓ Webhook OK (${res.status}) ${res.duration}ms`, 'success', 4000);
        } else {
          showToast(`✕ Webhook gagal: ${res.status} ${res.error || ''}`, 'error', 5000);
        }
      } catch (err) {
        showToast(err.message, 'error', 5000);
      } finally {
        b.disabled = false;
        b.textContent = '🧪 Test';
      }
    });
  });
}

function openWebhookModal(data = null) {
  const isEdit = !!data;
  showModal(`
    <div class="modal-box">
      <h3 class="font-bold text-lg">${isEdit ? 'Edit' : 'Tambah'} Webhook</h3>
      <form id="webhookForm" class="space-y-3 mt-4">
        <label class="floating-label">
          <span>Nama</span>
          <input type="text" id="w-name" class="input input-bordered w-full" required value="${data?.name || ''}" />
        </label>
        <label class="floating-label">
          <span>Type</span>
          <select id="w-type" class="select select-bordered w-full" required>
            <option value="discord" ${data?.type === 'discord' ? 'selected' : ''}>Discord</option>
            <option value="telegram" ${data?.type === 'telegram' ? 'selected' : ''}>Telegram</option>
            <option value="custom" ${data?.type === 'custom' ? 'selected' : ''}>Custom JSON</option>
          </select>
        </label>
        <label class="floating-label">
          <span>URL</span>
          <input type="url" id="w-url" class="input input-bordered w-full" required value="${data?.url || ''}" />
        </label>
        <label class="floating-label">
          <span>Trigger</span>
          <select id="w-trigger" class="select select-bordered w-full" required>
            <option value="paid" ${data?.trigger_on === 'paid' ? 'selected' : ''}>Saat paid saja</option>
            <option value="created" ${data?.trigger_on === 'created' ? 'selected' : ''}>Saat dibuat</option>
            <option value="both" ${data?.trigger_on === 'both' ? 'selected' : ''}>Keduanya</option>
          </select>
        </label>
        <label class="floating-label">
          <span>Secret (opsional, dikirim via header X-Webhook-Secret)</span>
          <input type="text" id="w-secret" class="input input-bordered w-full" value="${data?.secret || ''}" />
        </label>
        <label class="label cursor-pointer justify-start gap-2">
          <input type="checkbox" id="w-enabled" class="toggle toggle-primary" ${data?.enabled !== false ? 'checked' : ''} />
          <span>Aktif</span>
        </label>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" data-modal-close>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  `);
  document.getElementById('webhookForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('w-name').value,
      type: document.getElementById('w-type').value,
      url: document.getElementById('w-url').value,
      trigger_on: document.getElementById('w-trigger').value,
      secret: document.getElementById('w-secret').value || null,
      enabled: document.getElementById('w-enabled').checked,
    };
    try {
      if (isEdit) {
        await api(`/api/admin/webhooks/${data.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/admin/webhooks', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal();
      showToast('Webhook disimpan', 'success');
      renderWebhooks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ============================================
// TAB: SETTINGS
// ============================================
async function renderSettings() {
  const [config, settings] = await Promise.all([
    api('/api/config'),
    api('/api/admin/settings'),
  ]);

  document.getElementById('tabContent').innerHTML = `
    <div class="space-y-3">
      <h2 class="text-xl font-bold">⚙️ Settings</h2>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 space-y-3">
          <h3 class="font-bold text-sm">QRIS Statis</h3>
          <p class="text-xs text-base-content/60">String QRIS statis dari gambar QR kamu. Bisa juga upload gambar untuk auto-decode.</p>
          <textarea id="s-qris" class="textarea textarea-bordered font-mono text-xs" rows="3">${escapeHtml(settings.qris_static || '')}</textarea>

          <div class="divider text-xs">atau upload gambar QRIS</div>
          <input type="file" id="qrisUploadInput" accept="image/*" class="file-input file-input-bordered file-input-sm w-full" />
          <button id="decodeQrisBtn" class="btn btn-sm btn-outline">🔍 Decode & Preview</button>
          <div id="qrisPreviewWrap" class="hidden mt-2">
            <div class="alert alert-info">
              <div class="text-center w-full">
                <img id="qrisPreviewImg" class="w-40 h-40 mx-auto bg-white p-2 rounded" />
                <p class="text-xs mt-2">Preview QR dengan nominal Rp 10.000</p>
              </div>
            </div>
          </div>

          <button id="saveQrisBtn" class="btn btn-primary btn-sm">Simpan QRIS String</button>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 space-y-3">
          <h3 class="font-bold text-sm">Preset Nominal</h3>
          <p class="text-xs text-base-content/60">Pisahkan dengan koma. Contoh: 5000,10000,20000,50000,100000</p>
          <input type="text" id="s-presets" class="input input-bordered" value="${escapeHtml(settings.preset_amounts || '5000,10000,20000,50000,100000')}" />
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 space-y-3">
          <h3 class="font-bold text-sm">Batas Nominal</h3>
          <div class="grid grid-cols-2 gap-2">
            <label class="floating-label">
              <span>Min (Rp)</span>
              <input type="number" id="s-min" class="input input-bordered" value="${settings.min_amount || 2000}" />
            </label>
            <label class="floating-label">
              <span>Max (Rp)</span>
              <input type="number" id="s-max" class="input input-bordered" value="${settings.max_amount || 5000000}" />
            </label>
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 space-y-3">
          <h3 class="font-bold text-sm">Opsi Donasi</h3>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" id="s-custom" class="toggle toggle-primary" ${settings.custom_amount_enabled !== 'false' ? 'checked' : ''} />
            <span>Izinkan nominal custom</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" id="s-name" class="toggle toggle-primary" ${settings.donor_name_enabled !== 'false' ? 'checked' : ''} />
            <span>Izinkan input nama donor</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" id="s-msg" class="toggle toggle-primary" ${settings.message_enabled !== 'false' ? 'checked' : ''} />
            <span>Izinkan input pesan/dukungan</span>
          </label>
        </div>
      </div>

      <button id="saveSettingsBtn" class="btn btn-primary btn-block">Simpan Semua Settings</button>
    </div>
  `;

  // Decode QRIS
  document.getElementById('decodeQrisBtn').addEventListener('click', async () => {
    const file = document.getElementById('qrisUploadInput').files[0];
    if (!file) return showToast('Pilih gambar QR dulu', 'warning');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api('/api/admin/qris/preview', { method: 'POST', body: formData });
      document.getElementById('s-qris').value = res.qris;
      if (res.previewQr) {
        document.getElementById('qrisPreviewImg').src = res.previewQr;
        document.getElementById('qrisPreviewWrap').classList.remove('hidden');
      }
      showToast('QR berhasil di-decode', 'success');
    } catch (err) {
      showToast(err.message, 'error', 5000);
    }
  });

  // Save
  document.getElementById('saveQrisBtn').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ qris_static: document.getElementById('s-qris').value }),
      });
      showToast('QRIS disimpan', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          preset_amounts: document.getElementById('s-presets').value,
          min_amount: document.getElementById('s-min').value,
          max_amount: document.getElementById('s-max').value,
          custom_amount_enabled: document.getElementById('s-custom').checked,
          donor_name_enabled: document.getElementById('s-name').checked,
          message_enabled: document.getElementById('s-msg').checked,
        }),
      });
      showToast('Settings disimpan', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  attachTabEvents();
  checkSession();
});
