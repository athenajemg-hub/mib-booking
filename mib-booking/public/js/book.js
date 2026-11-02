(async function () {
  if (!requireLogin()) return;
  const $ = (id) => document.getElementById(id);
  const dstr = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
  const now = new Date();
  const today = dstr(now.getFullYear(), now.getMonth(), now.getDate());
  const S = {
    packages: [], addons: [], layouts: [], settings: { crews: 1 },
    pkg: null, date: null, time: '', timeOk: false, layout: null, addonSel: {},
    month: new Date(now.getFullYear(), now.getMonth(), 1), avail: { busy: {}, blocked: {} },
  };

  // Email confirmation notice (only shown when the site sends emails and this account isn't confirmed yet)
  const showVerify = () => ($('verify-banner').hidden = false);
  try {
    const { user } = await api('/auth/me');
    store.set(store.token, user); renderHeader();
    if (user.email_verified === false) showVerify();
  } catch (e) { return requireLogin(); }
  $('resend-verify').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { toast((await api('/auth/resend-verification', { method: 'POST' })).message); }
    catch (err) { toast(err.message, true); }
    setTimeout(() => (btn.disabled = false), 60000);
  };

  const hours = () => (S.pkg ? S.pkg.hours : S.packages.length ? Math.min(...S.packages.map((p) => p.hours)) : 3);
  const isFree = (ds, startMin, durMin) =>
    (S.avail.busy[ds] || []).filter(([s, e]) => s < startMin + durMin && e > startMin).length < S.settings.crews;
  // A day is full only if no start time at all would fit. A free start, if any exists,
  // begins at midnight or right when another booking ends, so those are the only times to test.
  const fullDay = (ds) => {
    const starts = [0, ...(S.avail.busy[ds] || []).map(([, e]) => e).filter((e) => e >= 0 && e < 1440)];
    return !starts.some((m) => isFree(ds, m, hours() * 60));
  };

  /* ---------- 1 · Package ---------- */
  function renderPackages() {
    $('pkg-options').innerHTML = S.packages.map((p) => `
      <div class="pick" role="radio" tabindex="0" aria-checked="${!!(S.pkg && S.pkg.id === p.id)}" data-id="${p.id}">
        <h4>${esc(p.name)}</h4>
        <div class="price">${peso(p.price)}</div>
        <div class="chips"><span class="chip">${esc(p.pax_range)} pax</span><span class="chip">${p.hours} hrs</span></div>
        <ul class="checks">${p.inclusions.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </div>`).join('');
  }
  function pickPackage(el) {
    if (!el) return;
    S.pkg = S.packages.find((p) => p.id === +el.dataset.id);
    renderPackages(); renderCalendar(); updateTimePanel(); refresh();
  }
  $('pkg-options').onclick = (e) => pickPackage(e.target.closest('.pick'));
  $('pkg-options').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickPackage(e.target.closest('.pick')); } };

  /* ---------- 2 · Date & time ---------- */
  async function loadMonth() {
    const m = `${S.month.getFullYear()}-${pad2(S.month.getMonth() + 1)}`;
    try { S.avail = await api('/availability?month=' + m); } catch (e) { toast(e.message, true); }
    renderCalendar();
    if (S.date) updateTimePanel();
  }

  function renderCalendar() {
    const y = S.month.getFullYear(), m = S.month.getMonth();
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const title = S.month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const canPrev = y * 12 + m > now.getFullYear() * 12 + now.getMonth();
    let cells = '<span></span>'.repeat(first);
    for (let d = 1; d <= days; d++) {
      const ds = dstr(y, m, d), blocked = S.avail.blocked[ds];
      let cls = 'day', dis = false, tip = '';
      if (ds <= today) { cls += ' past'; dis = true; }
      else if (blocked) { cls += ' blocked'; dis = true; tip = blocked; }
      else if (fullDay(ds)) { cls += ' full'; dis = true; tip = 'Fully booked'; }
      else if ((S.avail.busy[ds] || []).length) { cls += ' partial'; tip = 'Some times already booked'; }
      if (ds === S.date) cls += ' selected';
      if (ds === today) cls += ' today';
      cells += `<button type="button" class="${cls}" data-date="${ds}" title="${esc(tip)}" ${dis ? 'disabled' : ''}>${d}</button>`;
    }
    $('calendar').innerHTML = `
      <div class="cal-head">
        <button type="button" class="btn btn-sm btn-ghost" data-nav="-1" aria-label="Previous month" ${canPrev ? '' : 'disabled'}>←</button>
        <strong>${title}</strong>
        <button type="button" class="btn btn-sm btn-ghost" data-nav="1" aria-label="Next month">→</button>
      </div>
      <div class="cal-grid">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => `<span class="dow">${w}</span>`).join('')}${cells}</div>
      <div class="legend"><span>● Some times booked</span><span>▨ Fully booked</span><span>S̶ Holiday</span></div>`;
  }

  $('calendar').onclick = async (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + +nav.dataset.nav, 1); await loadMonth(); return; }
    const day = e.target.closest('.day');
    if (day && !day.disabled) { S.date = day.dataset.date; renderCalendar(); updateTimePanel(); $('start_time').focus({ preventScroll: true }); }
  };

  function updateTimePanel() {
    const inp = $('start_time');
    $('sel-date').textContent = S.date ? fmtDate(S.date) : 'Pick a date';
    inp.disabled = !S.date;
    const busy = S.date ? (S.avail.busy[S.date] || []).filter(([s, e]) => e > 0 && s < 1440).sort((a, b) => a[0] - b[0]) : [];
    $('busy-list').textContent = !S.date ? '' : busy.length
      ? 'Already booked: ' + busy.map(([s, e]) => `${fmtTime(fromMin(Math.max(s, 0)))} – ${fmtTime(fromMin(e))}`).join(', ')
      : 'No other bookings on this date yet.';
    validateTime();
  }

  const setHint = (cls, msg) => { const h = $('time-hint'); h.className = 'hint ' + cls; h.textContent = msg; };
  let vt;
  function validateTime() {
    clearTimeout(vt); S.timeOk = false;
    const t = $('start_time').value; S.time = t;
    if (!S.date) { setHint('', ''); refresh(); return; }
    if (!t) { setHint('', `Choose any start time you like — your event runs for ${hours()} hours.`); refresh(); return; }
    const m = toMin(t), dur = hours() * 60;
    if (!isFree(S.date, m, dur)) setHint('bad', 'That time overlaps with another booking. Try a different time.');
    else {
      setHint('', 'Checking availability…');
      vt = setTimeout(async () => {
        try {
          const r = await api(`/availability/check?date=${S.date}&time=${t}&hours=${hours()}`);
          if (S.time !== t) return;
          S.timeOk = !!r.ok;
          setHint(r.ok ? 'ok' : 'bad', r.ok ? `Available · ${timeRange(t, hours())}` : r.error);
        } catch (e) { setHint('bad', e.message); }
        refresh();
      }, 250);
    }
    refresh();
  }
  $('start_time').addEventListener('input', validateTime);

  /* ---------- 3 · Details ---------- */
  $('venue').addEventListener('input', refresh);

  /* ---------- 4 · Layout (example prints) ---------- */
  // Photo files live in /public/img/layouts — swap a file (keep its name) to change an example.
  const LAYOUT_IMG = { '4R Portrait': '4r-portrait', '4R Landscape': '4r-landscape', '4R Double Landscape': '4r-double-landscape', '4R Polaroid Portrait': '4r-polaroid-portrait', 'Filmstrip': 'filmstrip' };
  const imgOf = (l, thumb) => `/img/layouts/${LAYOUT_IMG[l] || 'filmstrip'}${thumb ? '-thumb' : ''}.jpg`;

  function renderLayouts() {
    $('layouts').innerHTML = S.layouts.map((l) => `
      <div class="lay" role="radio" tabindex="0" aria-checked="${S.layout === l}" data-l="${esc(l)}">
        <div class="stage"><img src="${imgOf(l, true)}" alt="Example of a ${esc(l)} print" loading="lazy"></div>
        <span class="lay-name">${esc(l)}</span>
        <button type="button" class="lay-zoom" data-zoom="${esc(l)}" aria-label="Enlarge example of ${esc(l)}">⤢</button>
      </div>`).join('');
  }
  function pickLayout(l) { S.layout = l; renderLayouts(); refresh(); }

  function openExample(l) {
    const o = document.createElement('div');
    o.className = 'overlay dark';
    o.innerHTML = `<figure class="lb"><img src="${imgOf(l)}" alt="Example of a ${esc(l)} print">
      <figcaption><strong>${esc(l)}</strong><span class="lb-actions">
        <button type="button" class="btn btn-sm" data-use>Choose this layout</button>
        <button type="button" class="btn btn-sm btn-ghost" data-close>Close</button></span></figcaption></figure>`;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { o.remove(); document.removeEventListener('keydown', onKey); };
    o.onclick = (e) => {
      if (e.target.closest('[data-use]')) { pickLayout(l); close(); }
      else if (e.target === o || e.target.closest('[data-close]')) close();
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(o);
    o.querySelector('[data-use]').focus();
  }
  $('layouts').onclick = (e) => {
    const z = e.target.closest('.lay-zoom'); if (z) return openExample(z.dataset.zoom);
    const c = e.target.closest('.lay'); if (c) pickLayout(c.dataset.l);
  };
  $('layouts').onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.lay-zoom')) {
      const c = e.target.closest('.lay'); if (c) { e.preventDefault(); pickLayout(c.dataset.l); }
    }
  };

  /* ---------- 5 · Add-ons ---------- */
  function renderAddons() {
    $('addons').innerHTML = S.addons.map((a) => `
      <div class="addon-pick">
        <div class="left"><input type="checkbox" id="a${a.id}" data-id="${a.id}">
          <label for="a${a.id}">${esc(a.name)} <span class="muted"> — ${peso(a.price)}${a.unit === 'hr' ? '/hr' : ''}${a.note ? ' · ' + esc(a.note) : ''}</span></label></div>
        ${a.unit === 'hr' ? `<input class="qty" type="number" min="1" max="12" value="1" data-qty="${a.id}" aria-label="Hours for ${esc(a.name)}">` : ''}
      </div>`).join('');
  }
  $('addons').onchange = (e) => {
    const id = e.target.dataset.id || e.target.dataset.qty; if (!id) return;
    const box = document.getElementById('a' + id), qty = document.querySelector(`[data-qty="${id}"]`);
    S.addonSel[id] = box.checked ? Math.max(1, Math.min(12, parseInt(qty ? qty.value : 1) || 1)) : 0;
    refresh();
  };

  /* ---------- Summary ---------- */
  function renderSummary() {
    const lines = []; let total = 0;
    if (S.pkg) { lines.push([S.pkg.name, S.pkg.price]); total += S.pkg.price; }
    S.addons.forEach((a) => {
      const q = S.addonSel[a.id];
      if (q) { const amt = a.price * q; lines.push([a.name + (a.unit === 'hr' ? ` × ${q} hr` : ''), amt]); total += amt; }
    });
    const info = [];
    if (S.layout) info.push(['Layout', esc(S.layout)]);
    if (S.date) info.push(['Date', fmtDate(S.date)]);
    if (S.date && S.timeOk) info.push(['Time', timeRange(S.time, hours())]);
    $('summary-lines').innerHTML = (lines.map(([n, a]) => `<div class="line"><span>${esc(n)}</span><span>${peso(a)}</span></div>`).join('')
      + info.map(([k, v]) => `<div class="line"><span class="muted" style="color:rgba(255,255,255,.65)">${k}</span><span>${v}</span></div>`).join(''))
      || '<p class="small" style="opacity:.7">Choose a package to begin.</p>';
    $('total').textContent = peso(total);
    const pct = S.settings.deposit_percent;
    $('fee-note').textContent = total && pct > 0
      ? `Reservation fee (${pct}%): ${peso(Math.round((total * pct) / 100))}. You will send it right after submitting to secure your date.` : '';
  }
  function markDone() {
    const done = { 'step-pkg': !!S.pkg, 'step-dt': !!(S.date && S.timeOk), 'step-details': !!$('venue').value.trim(), 'step-layout': !!S.layout };
    Object.entries(done).forEach(([id, v]) => $(id).classList.toggle('done', v));
    $('progress').style.width = (Object.values(done).filter(Boolean).length / 4) * 100 + '%';
  }
  function refresh() { renderSummary(); markDone(); }

  /* ---------- Submit ---------- */
  const jump = (id, msg) => { toast(msg, true); $(id).scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('submit-booking').onclick = async () => {
    if (!S.pkg) return jump('step-pkg', 'Please choose a package.');
    if (!S.date) return jump('step-dt', 'Please choose a date.');
    if (!S.timeOk) return jump('step-dt', 'Please choose an available start time.');
    if (!$('venue').value.trim()) { $('venue').focus(); return jump('step-details', 'Please enter the venue.'); }
    if (!S.layout) return jump('step-layout', 'Please choose a print layout.');
    const btn = $('submit-booking'); btn.classList.add('loading');
    try {
      const made = await api('/bookings', { method: 'POST', body: {
        package_id: S.pkg.id, event_date: S.date, start_time: S.time, layout: S.layout,
        event_type: $('event_type').value, venue: $('venue').value, guests: $('guests').value, notes: $('notes').value,
        addons: Object.entries(S.addonSel).filter(([, q]) => q).map(([id, qty]) => ({ id: +id, qty })) } });
      toast('Booking request sent!');
      setTimeout(() => (location.href = '/bookings.html?pay=' + made.id), 900);
    } catch (e) {
      toast(e.message, true); btn.classList.remove('loading');
      if (e.status === 403) showVerify();
      if (e.status === 409) loadMonth();
    }
  };

  /* ---------- Init ---------- */
  try {
    [S.packages, S.addons, S.layouts, S.settings] = await Promise.all([api('/packages'), api('/addons'), api('/layouts'), api('/settings')]);
  } catch (e) { toast(e.message, true); return; }
  const pre = +new URLSearchParams(location.search).get('package');
  S.pkg = S.packages.find((p) => p.id === pre) || null;
  renderPackages(); renderLayouts(); renderAddons(); updateTimePanel(); refresh();
  await loadMonth();
})();
