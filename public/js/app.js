/* Shared helpers: API client, session, header/footer, reveal animations, toasts */
const store = {
  get token() { return localStorage.getItem('mib_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('mib_user')); } catch { return null; } },
  set(token, user) { localStorage.setItem('mib_token', token); localStorage.setItem('mib_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('mib_token'); localStorage.removeItem('mib_user'); },
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(store.token ? { Authorization: 'Bearer ' + store.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && store.token) store.clear();
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH');
const pad2 = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => { n = ((n % 1440) + 1440) % 1440; return `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`; };
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const fmtTime = (t) => { const m = toMin(t), h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${pad2(m % 60)} ${h >= 12 ? 'PM' : 'AM'}`; };
const timeRange = (t, hours) => `${fmtTime(t)} – ${fmtTime(fromMin(toMin(t) + hours * 60))}`;

function toast(msg, isError) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = 0; setTimeout(() => el.remove(), 400); }, 3800);
}

function requireLogin(roles) {
  const u = store.user;
  if (!store.token || !u) {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return false;
  }
  if (roles && !roles.includes(u.role)) { location.href = '/index.html'; return false; }
  return true;
}

function observeReveal(root = document) {
  const items = [...root.querySelectorAll('.reveal:not(.in)')];
  if (!('IntersectionObserver' in window)) return items.forEach((e) => e.classList.add('in'));
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  items.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 90 + 'ms'; io.observe(el); });
}

const BELL = `
  <div class="bell" id="bell">
    <button class="bell-btn" type="button" aria-label="Notifications" aria-haspopup="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      <span class="bell-badge" hidden>0</span>
    </button>
    <div class="bell-panel" hidden>
      <div class="bell-head"><strong>Notifications</strong><button type="button" class="bell-readall">Mark all read</button></div>
      <div class="bell-list"></div>
    </div>
  </div>`;

function initBell() {
  if (window.__bellCleanup) window.__bellCleanup();
  const wrap = document.getElementById('bell');
  if (!wrap || !store.user) return;
  const badge = wrap.querySelector('.bell-badge'), panel = wrap.querySelector('.bell-panel'), list = wrap.querySelector('.bell-list');
  let items = [];
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' hr ago' : Math.floor(s / 86400) + ' d ago';
  };
  function render() {
    list.innerHTML = items.length ? items.map((n) => `
      <button type="button" class="bell-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}">
        <strong>${esc(n.title)}</strong><span>${esc(n.body || '')}</span><small>${ago(n.created_at)}</small>
      </button>`).join('') : '<p class="bell-empty">No notifications yet.</p>';
  }
  async function load() {
    try {
      const r = await api('/notifications');
      items = r.items; badge.textContent = r.unread > 9 ? '9+' : r.unread; badge.hidden = !r.unread; render();
    } catch {}
  }
  const onDocClick = (e) => { if (!wrap.contains(e.target)) panel.hidden = true; };
  const onKey = (e) => { if (e.key === 'Escape') panel.hidden = true; };
  wrap.querySelector('.bell-btn').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) load(); };
  list.onclick = async (e) => {
    const b = e.target.closest('.bell-item'); if (!b) return;
    try { await api('/notifications/read', { method: 'POST', body: { id: +b.dataset.id } }); } catch {}
    if (b.dataset.link) location.href = b.dataset.link; else load();
  };
  wrap.querySelector('.bell-readall').onclick = async () => { try { await api('/notifications/read', { method: 'POST', body: {} }); } catch {} load(); };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  const timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
  window.__bellCleanup = () => { clearInterval(timer); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); };
  load();
}

function renderHeader() {
  const el = document.getElementById('site-header');
  if (!el) return;
  const u = store.user;
  const here = location.pathname;
  const link = (href, label) => `<a href="${href}" class="${here === href ? 'active' : ''}">${label}</a>`;
  el.innerHTML = `
    <div class="container nav">
      <a class="logo" href="/index.html" aria-label="MIB Photoman home"><img class="logo-img" src="/img/logo.png" alt="MIB Photoman"></a>
      <div class="nav-right">
        <nav class="nav-links">
          ${link('/index.html', 'Home')}
          <a href="/index.html#packages">Packages</a>
          ${link('/book.html', 'Book')}
          ${u ? link('/bookings.html', 'My Bookings') : ''}
          ${u ? link('/account.html', 'Account') : ''}
          ${u && u.role !== 'customer' ? link('/admin.html', 'Admin') : ''}
          ${u ? '<a href="#" id="logout">Logout</a>' : '<a class="btn btn-sm" href="/login.html">Login</a>'}
        </nav>
        ${u ? BELL : ''}
        <button class="nav-toggle" aria-label="Menu">☰</button>
      </div>
    </div>`;
  el.querySelector('.nav-toggle').onclick = () => el.querySelector('.nav-links').classList.toggle('open');
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = (e) => { e.preventDefault(); store.clear(); location.href = '/index.html'; };
  if (!el.dataset.scrollBound) {
    el.dataset.scrollBound = '1';
    const onScroll = () => el.classList.toggle('scrolled', window.scrollY > 12);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  }
  initBell();
}

function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.classList.add('dark');
  el.innerHTML = `
    <div class="container">
      <div class="foot">
        <div><img src="/img/logo-white.png" alt="MIB Photoman"><p class="muted" style="max-width:30ch">Event photography + On-site printing.</p></div>
        <div><strong>Contact</strong><br><br>
          <a href="mailto:hello@mibphotoman.com">hello@mibphotoman.com</a><br>
          09666794369 (Sharmaine)<br>09271850984 (Cypher)<br>mibphotomanph</div>
      </div>
      <p class="copy">© ${new Date().getFullYear()} MIB Photoman. Transportation fee and crew meals are not included in package prices.</p>
    </div>`;
}

function initPasswordVisibility() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.visibilityReady) return;
    const field = input.closest('.field') || input.parentElement;
    if (!field) return;
    input.dataset.visibilityReady = '1';
    field.classList.add('password-field');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    toggle.addEventListener('click', () => {
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      toggle.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', String(showing));
    });
    field.appendChild(toggle);
  });
}


function initSupportWidget() {
  if (location.pathname === '/admin.html' || document.getElementById('mib-support')) return;
  const root = document.createElement('div');
  root.id = 'mib-support';
  root.innerHTML = `
    <button class="mib-support-trigger" type="button" aria-label="Open customer support" aria-expanded="false" aria-controls="mib-support-panel">
      <span aria-hidden="true">?</span>
    </button>
    <section class="mib-support-panel" id="mib-support-panel" aria-label="Customer support" aria-hidden="true">
      <div class="mib-support-head">
        <div><span class="mib-support-kicker">MIB PHOTOMAN</span><h2>How can we help?</h2><p>Find an answer or contact our team.</p></div>
        <button class="mib-support-close" type="button" aria-label="Close support panel">×</button>
      </div>
      <div class="mib-support-content">
        <h3>Frequently asked questions</h3>
        <details><summary>How do I book an event?</summary><p>Open the Book page, choose a package, select an available date and time, complete your event details, then submit your booking request.</p></details>
        <details><summary>When is my booking confirmed?</summary><p>Your booking remains pending until the MIB Photoman team reviews and approves your request. Check My Bookings for updates.</p></details>
        <details><summary>How do I pay?</summary><p>Open your booking details to view the payment instructions. Submit your payment reference or proof when requested.</p></details>
        <details><summary>Can I cancel or reschedule?</summary><p>Open My Bookings and use the available request option on the booking. The team will review your request.</p></details>
        <div class="mib-support-contact">
          <strong>Still need help?</strong>
          <a href="mailto:hello@mibphotoman.com?subject=MIB%20Photoman%20Customer%20Support">Email hello@mibphotoman.com</a>
          <a href="tel:+639666794369">Call 0966 679 4369</a>
          <a href="tel:+639271850984">Call 0927 185 0984</a>
        </div>
      </div>
    </section>`;
  document.body.appendChild(root);
  const trigger = root.querySelector('.mib-support-trigger');
  const panel = root.querySelector('.mib-support-panel');
  const close = root.querySelector('.mib-support-close');
  const icon = trigger.querySelector('span');
  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    trigger.classList.toggle('is-active', open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'Close customer support' : 'Open customer support');
    icon.textContent = open ? '×' : '?';
  };
  setOpen(false);
  trigger.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  close.addEventListener('click', () => setOpen(false));
  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
}

document.addEventListener('DOMContentLoaded', () => { renderHeader(); renderFooter(); observeReveal(); initPasswordVisibility(); initSupportWidget(); });
