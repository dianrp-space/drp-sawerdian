/**
 * Sawerdian - Section Pesan & Komentar di halaman utama
 * Menampilkan pesan donasi (dengan komentarnya) dan form untuk menambah komentar.
 */

(function () {
  'use strict';

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
      // [SECURITY] Rate limit (HTTP 429): tampilkan sisa waktu dari header
      // `Retry-After` (detik) atau `RateLimit-Reset` (unix seconds) supaya
      // user tahu kapan boleh coba lagi.
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const reset = res.headers.get('ratelimit-reset');
        let waitMsg = 'beberapa saat lagi';
        if (retryAfter) {
          const sec = parseInt(retryAfter, 10);
          if (Number.isFinite(sec) && sec > 0) {
            waitMsg = sec < 60 ? `${sec} detik` : `${Math.ceil(sec / 60)} menit`;
          }
        } else if (reset) {
          const sec = parseInt(reset, 10) - Math.floor(Date.now() / 1000);
          if (Number.isFinite(sec) && sec > 0) {
            waitMsg = sec < 60 ? `${sec} detik` : `${Math.ceil(sec / 60)} menit`;
          }
        }
        const msg = data?.error || 'Terlalu banyak permintaan';
        throw new Error(`${msg} Coba lagi dalam ${waitMsg}.`);
      }
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }

  // ============================================
  // State
  // ============================================
  const PAGE_SIZE = 100; // Ambil batch cukup besar untuk mencari top 3 sawer yang meninggalkan pesan
  const PREVIEW_COMMENTS = 2;
  const state = {
    period: 'all',
    items: [],
    offset: 0,
    total: 0,
    loading: false,
    donationOptions: [],
    expandedDonations: new Set(),
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

  function isValidCommentAuthorName(name) {
    return /^[A-Za-zÀ-ÿ\s]+$/.test(name);
  }

  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
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
  // Render
  // ============================================
  function renderMessages() {
    const list = document.getElementById('messagesList');
    if (!list) return;
    list.innerHTML = '';

    if (!state.items.length) {
      list.innerHTML = `<div class="text-sm text-base-content/50 italic">Belum ada pesan pada periode ini.</div>`;
    } else {
      state.items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'card bg-base-200/60 shadow-sm';
        const comments = Array.isArray(item.comments) ? item.comments : [];
        const remaining = Math.max(0, 100 - comments.length);

        const showAll = state.expandedDonations.has(item.id);
        const visibleComments = showAll ? comments : comments.slice(0, PREVIEW_COMMENTS);
        const hiddenCount = comments.length - visibleComments.length;

        card.innerHTML = `
          <div class="card-body p-3">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-semibold truncate">${escapeHtml(item.donorName)}</span>
                  <span class="badge badge-primary badge-sm font-semibold">${escapeHtml(item.amountFormatted || '')}</span>
                  <span class="text-xs text-base-content/50">•</span>
                  <span class="text-xs text-base-content/50">${timeAgo(item.paidAt)}</span>
                </div>
                <p class="text-sm text-base-content/80 mt-1 whitespace-pre-wrap break-words">"${escapeHtml(item.message)}"</p>

                <div class="mt-2">
                  <div class="text-xs text-base-content/60 mb-1">Komentar (${comments.length}/100) • Sisa slot: ${remaining}</div>
                  ${visibleComments.length > 0 ? `
                    <div class="space-y-1 mb-2">
                      ${visibleComments.map((c) => `
                        <div class="bg-base-100/70 rounded p-2">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-sm font-medium">${escapeHtml(c.authorName || 'Anonim')}</span>
                            <span class="text-xs text-base-content/50">${timeAgo(c.createdAt)}</span>
                          </div>
                          <p class="text-sm text-base-content/70 whitespace-pre-wrap break-words">${escapeHtml(c.content)}</p>
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}

                  ${hiddenCount > 0 ? `
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs mb-2 show-all-comments-btn"
                      data-donation-id="${item.id}"
                    >
                      Tampilkan semua komentar (+${hiddenCount})
                    </button>
                  ` : (showAll && comments.length > PREVIEW_COMMENTS ? `
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs mb-2 show-all-comments-btn"
                      data-donation-id="${item.id}"
                    >
                      Sembunyikan komentar
                    </button>
                  ` : '')}

                  <button
                    type="button"
                    class="btn btn-outline btn-xs toggle-comment-form-btn"
                    data-donation-id="${item.id}"
                    data-donation-label="${escapeHtml(item.donorName)}"
                    ${remaining <= 0 ? 'disabled' : ''}
                  >
                    💬 ${remaining <= 0 ? 'Batas komentar tercapai' : 'Komentar'}
                  </button>

                  <form class="comment-form mt-2 hidden space-y-2" data-donation-id="${item.id}" novalidate>
                    <input
                      type="text"
                      name="authorName"
                      class="input input-bordered input-sm w-full"
                      placeholder="Namamu (hanya huruf & spasi)"
                      maxlength="100"
                      pattern="[A-Za-zÀ-ÿ ]+"
                      title="Nama hanya boleh berisi huruf dan spasi"
                      required
                    />
                    <textarea
                      name="content"
                      class="textarea textarea-bordered w-full"
                      placeholder="Tulis komentar..."
                      maxlength="500"
                      rows="3"
                      ${remaining <= 0 ? 'disabled' : ''}
                      required
                    ></textarea>
                    <div class="flex items-center justify-end gap-2">
                      <button type="submit" class="btn btn-primary btn-sm" ${remaining <= 0 ? 'disabled' : ''}>
                        Kirim Komentar
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        `;
        list.appendChild(card);
      });
    }

    const countEl = document.getElementById('commentsCount');
    if (countEl) {
      countEl.textContent = `${state.items.length} pesan dimuat`;
    }

    const moreBtn = document.getElementById('loadMoreMessagesBtn');
    if (moreBtn) {
      moreBtn.classList.toggle('hidden', state.items.length >= state.total);
    }
  }

  function renderDonationOptions() {
    // Form komentar terpisah (dropdown pilihan pesan) sudah dihapus dari UI,
    // jadi fungsi ini hanya menyimpan data opsi tanpa merender elemen yang tidak ada.
    return;
  }

  // ============================================
  // Load data
  // ============================================
  async function loadMessages({ reset = false } = {}) {
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.items = [];
      state.offset = 0;
    }

    try {
      const data = await api(
        `/api/leaderboard?period=${state.period}&limit=${PAGE_SIZE}&offset=${state.offset}`
      );
      const newItems = (data.items || []).filter((item) => Boolean(item.message));
      
      // Hanya ambil 3 teratas dengan nilai sawer terbesar
      state.items = newItems.slice(0, 3);
      state.total = state.items.length;
      state.offset = state.items.length;

      // Rebuild options for "komentar baru" form (only donations with message + paid)
      state.donationOptions = state.items.map((item) => ({
        id: item.id,
        donorName: item.donorName,
        amountFormatted: item.amountFormatted || '',
        messagePreview:
          (item.message || '').length > 60
            ? item.message.slice(0, 60) + '...'
            : item.message || '',
      }));

      renderMessages();
      renderDonationOptions();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Gagal memuat pesan', 'error');
    } finally {
      state.loading = false;
    }
  }

  // ============================================
  // Actions
  // ============================================
  async function refreshCommentsForDonation(donationId) {
    try {
      const data = await api(`/api/leaderboard/${donationId}/comments`);
      const comments = data.items || [];
      state.items = state.items.map((item) =>
        item.id === donationId ? { ...item, comments, commentCount: comments.length } : item
      );
      renderMessages();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Gagal memuat komentar', 'error');
    }
  }

  async function submitInlineComment(form) {
    const donationId = parseInt(form.dataset.donationId, 10);
    const formData = new FormData(form);
    const authorName = String(formData.get('authorName') || '').trim();
    const content = String(formData.get('content') || '').trim();

    if (!authorName) {
      showToast('Nama komentar wajib diisi', 'warning');
      return;
    }
    if (!isValidCommentAuthorName(authorName)) {
      showToast('Nama komentar hanya boleh berisi huruf dan spasi', 'warning');
      return;
    }
    if (!content) {
      showToast('Komentar tidak boleh kosong', 'warning');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mengirim...';
    }

    try {
      await api(`/api/leaderboard/${donationId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ authorName, content }),
      });
      showToast('Komentar berhasil ditambahkan', 'success');
      form.reset();
      form.classList.add('hidden');
      await refreshCommentsForDonation(donationId);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Gagal mengirim komentar', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Komentar';
      }
    }
  }

  // ============================================
  // Events
  // ============================================
  function attachEvents() {
    document.querySelectorAll('.comment-period-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const period = btn.dataset.period;
        if (!period || period === state.period) return;
        state.period = period;
        document.querySelectorAll('.comment-period-btn').forEach((b) => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-outline');
        });
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary');
        loadMessages({ reset: true });
      });
    });

    const loadMoreBtn = document.getElementById('loadMoreMessagesBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => loadMessages({ reset: false }));
    }

    const messagesList = document.getElementById('messagesList');
    if (messagesList) {
      messagesList.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.toggle-comment-form-btn');
        if (toggleBtn) {
          const donationId = parseInt(toggleBtn.dataset.donationId, 10);
          const form = messagesList.querySelector(`.comment-form[data-donation-id="${donationId}"]`);
          if (form) form.classList.toggle('hidden');
          return;
        }

        const showAllBtn = e.target.closest('.show-all-comments-btn');
        if (showAllBtn) {
          const donationId = parseInt(showAllBtn.dataset.donationId, 10);
          if (!Number.isFinite(donationId)) return;
          if (state.expandedDonations.has(donationId)) {
            state.expandedDonations.delete(donationId);
          } else {
            state.expandedDonations.add(donationId);
          }
          renderMessages();
        }
      });

      messagesList.addEventListener('submit', (e) => {
        const form = e.target.closest('.comment-form');
        if (!form) return;
        e.preventDefault();
        submitInlineComment(form);
      });
    }
  }

  // ============================================
  // Init
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('commentsSection');
    if (!section) return;
    attachEvents();
    loadMessages({ reset: true });
  });
})();