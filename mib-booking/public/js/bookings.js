(async function () {
  if (!requireLogin()) return;
  const $ = (id) => document.getElementById(id);
  let all = [], tab = 'upcoming';
  const today = new Date().toLocaleDateString('en-CA');

  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    tab = t.dataset.tab; render();
  }));

  const isUpcoming = (b) => ['pending', 'approved'].includes(b.status) && b.event_date >= today;

  function tracker(b) {
    const steps = b.status === 'rejected' ? ['Requested', 'Declined', 'Confirmed']
      : b.status === 'cancelled' ? ['Requested', 'Cancelled']
      : ['Requested', 'Under review', 'Confirmed'];
    const at = b.status === 'pending' ? 1 : b.status === 'approved' ? 2 : b.status === 'rejected' ? 1 : steps.length - 1;
    return `<div class="track" aria-label="Booking progress">${steps.map((s, k) => {
      const cls = k < at || (k === at && b.status === 'approved') ? 'done' : k === at ? 'cur' : 'off';
      return `${k ? `<span class="ln ${k <= at ? 'done' : ''}"></span>` : ''}<div class="t ${cls}"><i class="dot"></i><span>${s}</span></div>`;
    }).join('')}</div>`;
  }

  const PAY_LABEL = { unpaid: 'Unpaid', proof_sent: 'Verifying', deposit_paid: 'Deposit paid', paid: 'Paid' };

  function payBox(b) {
    const active = ['pending', 'approved'].includes(b.status);
    if (!active && b.payment_status === 'unpaid') return '';
    const balance = Math.max(0, b.total - b.amount_paid);
    const text = b.payment_status === 'unpaid'
      ? `Reservation fee: <strong>${peso(b.deposit_amount || 0)}</strong>. Pay it to secure your date.`
      : b.payment_status === 'proof_sent'
      ? `We received your payment details (ref. ${esc(b.payment_ref || '')}). We will confirm once verified.`
      : b.payment_status === 'deposit_paid'
      ? `Deposit received: <strong>${peso(b.amount_paid)}</strong>. Balance due on or before your event: <strong>${peso(balance)}</strong>.`
      : 'Fully paid. Thank you!';
    const canPay = active && ['unpaid', 'deposit_paid'].includes(b.payment_status) && balance > 0;
    return `<div class="pay-box"><div><span class="badge ${b.payment_status}">${PAY_LABEL[b.payment_status]}</span>
      <p class="small" style="margin-top:.5rem">${text}</p></div>
      ${canPay ? `<button class="btn btn-sm" data-act="pay">${b.payment_status === 'unpaid' ? 'Submit payment' : 'Pay balance'}</button>` : ''}
      ${active && b.payment_status === 'proof_sent' ? '<button class="btn btn-sm btn-ghost" data-act="pay">Edit details</button>' : ''}</div>`;
  }

  function card(b) {
    const note = b.change_type === 'cancel' ? 'Cancellation requested — waiting for staff approval.'
      : b.change_type === 'reschedule' ? `Reschedule requested to ${fmtDate(b.new_date)} at ${fmtTime(b.new_start_time)} — waiting for staff approval.` : '';
    const canChange = ['pending', 'approved'].includes(b.status) && !b.change_type;
    const addons = b.addons.length ? b.addons.map((a) => `${esc(a.name)}${a.qty > 1 ? ' ×' + a.qty : ''}`).join(', ') : '—';
    return `
      <article class="card bk reveal" data-id="${b.id}">
        <div class="bk-top">
          <div><p class="eyebrow">Booking #${b.id}</p><h3>${esc(b.package_name)}</h3></div>
          <span class="badge ${b.status}">${b.status}</span>
        </div>
        ${tracker(b)}
        <dl class="bk-meta">
          <div><dt>Date</dt><dd>${fmtDate(b.event_date)}</dd></div>
          <div><dt>Time</dt><dd>${b.start_time ? timeRange(b.start_time, b.hours || 0) : '—'}</dd></div>
          <div><dt>Print layout</dt><dd>${esc(b.layout || '—')}</dd></div>
          <div><dt>Event</dt><dd>${esc(b.event_type)}</dd></div>
          <div><dt>Venue</dt><dd>${esc(b.venue)}</dd></div>
          <div><dt>Add-ons</dt><dd>${addons}</dd></div>
          <div><dt>Total</dt><dd><strong>${peso(b.total)}</strong></dd></div>
        </dl>
        ${payBox(b)}
        ${note ? `<div class="note-box">${note}</div>` : ''}
        ${canChange ? `<div class="actions-row">
          <button class="btn btn-sm btn-ghost" data-act="resched">Reschedule</button>
          <button class="btn btn-sm btn-ghost" data-act="cancel">${b.status === 'pending' ? 'Cancel booking' : 'Request cancellation'}</button></div>` : ''}
      </article>`;
  }

  function render() {
    const list = all.filter((b) => (tab === 'upcoming') === isUpcoming(b))
      .sort((a, b) => (tab === 'upcoming' ? a.event_date.localeCompare(b.event_date) : b.event_date.localeCompare(a.event_date)));
    $('bookings').innerHTML = list.length ? list.map(card).join('')
      : `<div class="empty"><p>${tab === 'upcoming' ? 'No upcoming bookings yet.' : 'Nothing here yet.'}</p>
         ${tab === 'upcoming' ? '<p style="margin-top:1.2rem"><a class="btn btn-sm" href="/book.html">Make your first booking</a></p>' : ''}</div>`;
    observeReveal($('bookings'));
  }

  async function load() {
    try { all = await api('/bookings/mine'); render(); }
    catch (e) { $('bookings').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  $('bookings').onclick = async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.closest('.bk').dataset.id;
    if (btn.dataset.act === 'pay') return openPayment(id);
    if (btn.dataset.act === 'cancel') {
      if (!confirm('Are you sure you want to cancel this booking?')) return;
      try { const r = await api(`/bookings/${id}/cancel`, { method: 'POST' }); toast(r.message); load(); } catch (err) { toast(err.message, true); }
    } else openReschedule(id);
  };

  async function openReschedule(id) {
    const min = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<form class="modal"><h3>Request reschedule</h3>
      <div class="field"><label for="rs-date">New date</label><input type="date" id="rs-date" min="${min}" required></div>
      <div class="field"><label for="rs-time">Start time</label><input type="time" id="rs-time" required></div>
      <p class="muted small" style="margin-bottom:1.3rem">Choose any start time you like. Staff will confirm your new schedule.</p>
      <div class="actions-row"><button class="btn" type="submit">Send request</button><button class="btn btn-ghost" type="button" id="rs-close">Close</button></div></form>`;
    document.body.appendChild(o);
    o.onclick = (e) => { if (e.target === o) o.remove(); };
    o.querySelector('#rs-close').onclick = () => o.remove();
    o.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api(`/bookings/${id}/reschedule`, { method: 'POST', body: { new_date: o.querySelector('#rs-date').value, new_time: o.querySelector('#rs-time').value } });
        toast(r.message); o.remove(); load();
      } catch (err) { toast(err.message, true); }
    };
  }

  // ---- Payment: reference number + optional screenshot (compressed in the browser) ----
  function compressImage(file, maxW = 1000, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = url;
    });
  }

  async function openPayment(id) {
    const b = all.find((x) => String(x.id) === String(id)); if (!b) return;
    let st = { payment_instructions: '' };
    try { st = await api('/settings'); } catch {}
    const due = b.payment_status === 'deposit_paid' ? b.total - b.amount_paid : (b.deposit_amount || b.total);
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<form class="modal"><h3>Submit payment</h3>
      <p class="small muted" style="margin-bottom:.6rem">Booking #${b.id} · Total ${peso(b.total)}</p>
      <div class="instructions">${esc(st.payment_instructions)}</div>
      <div class="row">
        <div class="field"><label for="pm-method">Paid via</label><select id="pm-method"><option>GCash</option><option>Maya</option><option>Bank transfer</option><option>Other</option></select></div>
        <div class="field"><label for="pm-amount">Amount sent (₱)</label><input id="pm-amount" type="number" min="1" max="${b.total}" step="0.01" value="${due}" required></div>
      </div>
      <div class="field"><label for="pm-ref">Reference number</label><input id="pm-ref" value="${esc(b.payment_ref || '')}" placeholder="From your payment receipt" required></div>
      <div class="field"><label for="pm-proof">Screenshot of receipt (optional)</label><input id="pm-proof" type="file" accept="image/*"></div>
      <div class="actions-row"><button class="btn" type="submit">Send payment details</button><button class="btn btn-ghost" type="button" id="pm-close">Later</button></div></form>`;
    document.body.appendChild(o);
    o.onclick = (e) => { if (e.target === o) o.remove(); };
    o.querySelector('#pm-close').onclick = () => o.remove();
    o.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]'); btn.classList.add('loading');
      try {
        const f = o.querySelector('#pm-proof').files[0];
        const proof = f ? await compressImage(f) : undefined;
        const r = await api(`/bookings/${id}/payment`, { method: 'POST', body: {
          method: o.querySelector('#pm-method').value, amount: o.querySelector('#pm-amount').value, reference: o.querySelector('#pm-ref').value, proof } });
        toast(r.message); o.remove(); load();
      } catch (err) { toast(err.message, true); btn.classList.remove('loading'); }
    };
  }

  load().then(() => { const pay = new URLSearchParams(location.search).get('pay'); if (pay) { history.replaceState(null, '', '/bookings.html'); openPayment(pay); } });
})();
