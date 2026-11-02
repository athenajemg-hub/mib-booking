(async function () {
  if (!requireLogin(['staff', 'admin'])) return;
  const isAdmin = store.user.role === 'admin';
  const $ = (id) => document.getElementById(id);
  let staff = [], rowMap = {};
  const PAY_LABEL = { unpaid: 'Unpaid', proof_sent: 'Verify', deposit_paid: 'Deposit paid', paid: 'Paid' };

  $('admin-role').textContent = isAdmin ? 'Administrator' : 'Staff';
  if (!isAdmin) $('manage-tab').style.display = 'none';

  /* ---- Tabs ---- */
  const loaders = { dash: loadDash, reservations: loadReservations, manage: loadManage };
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    ['dash', 'reservations', 'manage'].forEach((k) => ($('tab-' + k).hidden = k !== t.dataset.tab));
    loaders[t.dataset.tab]();
  }));

  const act = async (fn, okMsg, reload) => {
    try { await fn(); if (okMsg) toast(okMsg); if (reload) reload(); } catch (e) { toast(e.message, true); }
  };

  /* ---- Dashboard ---- */
  const bars = (rows) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return rows.length ? rows.map((r) => `<div class="bar-row"><span>${esc(r.label)}</span><div class="bar-track"><div class="bar" style="width:${(r.n / max) * 100}%"></div></div><b>${r.n}</b></div>`).join('') : '<p class="muted small">No data yet.</p>';
  };

  async function loadDash() {
    try {
      const a = await api('/admin/analytics');
      $('tab-dash').innerHTML = `
        <div class="stats">
          <div class="stat inv"><b>${a.total}</b><span>Total bookings</span></div>
          <div class="stat"><b>${a.pending}</b><span>Pending approval</span></div>
          <div class="stat"><b>${a.approved}</b><span>Approved</span></div>
          <div class="stat"><b>${a.cancellation_rate}%</b><span>Cancellation rate</span></div>
          <div class="stat inv"><b>${peso(a.revenue)}</b><span>Approved revenue</span></div>
          <div class="stat"><b>${peso(a.collected)}</b><span>Payments collected</span></div>
        </div>
        <div class="chart-grid">
          <div class="panel"><h3>Peak start times</h3>${bars(a.by_hour)}</div>
          <div class="panel"><h3>Bookings by month</h3>${bars(a.by_month)}</div>
          <div class="panel"><h3>Popular packages</h3>${bars(a.by_package)}</div>
          <div class="panel"><h3>Popular layouts</h3>${bars(a.by_layout)}</div>
        </div>`;
    } catch (e) { toast(e.message, true); }
  }

  /* ---- Reservations / approval workflow ---- */
  async function loadReservations() {
    try {
      if (!staff.length) staff = await api('/admin/staff');
      const q = $('status-filter').value;
      const rows = await api('/admin/bookings' + (q ? '?status=' + q : ''));
      rowMap = Object.fromEntries(rows.map((r) => [r.id, r]));
      if (!rows.length) { $('res-table').innerHTML = '<div class="empty">No reservations found.</div>'; return; }
      $('res-table').innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>#</th><th>Customer</th><th>Package</th><th>Date &amp; time</th><th>Venue</th><th>Total</th><th>Payment</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>
        ${rows.map((b) => `<tr data-id="${b.id}">
          <td>${b.id}</td>
          <td><strong>${esc(b.customer_name)}</strong><br>${esc(b.customer_email)}<br>${esc(b.customer_phone || '')}</td>
          <td>${esc(b.package_name)}<br><small class="muted">${esc(b.layout || 'No layout')}</small>${b.addons.length ? `<br><small class="muted">+${b.addons.length} add-on(s)</small>` : ''}</td>
          <td>${fmtDate(b.event_date)}<br><small>${b.start_time ? timeRange(b.start_time, b.hours || 0) : ''}</small></td>
          <td>${esc(b.venue)}</td>
          <td>${peso(b.total)}</td>
          <td><span class="badge ${b.payment_status}">${PAY_LABEL[b.payment_status]}</span>
            <br><small>${peso(b.amount_paid)} paid · fee ${peso(b.deposit_amount || 0)}</small>
            ${b.payment_ref ? `<br><small class="muted">${esc(b.payment_method)} · ref ${esc(b.payment_ref)}${b.payment_status === 'proof_sent' ? ` · sent ${peso(b.payment_claimed)}` : ''}</small>` : ''}
            <div class="actions-row" style="margin-top:.5rem">
              ${b.has_proof ? '<button class="btn btn-sm btn-ghost" data-do="proof">View proof</button>' : ''}
              ${['proof_sent', 'unpaid'].includes(b.payment_status) ? `<button class="btn btn-sm" data-do="pay-verify">${b.payment_status === 'unpaid' ? 'Record deposit' : 'Verify deposit'}</button>` : ''}
              ${b.payment_status === 'proof_sent' ? '<button class="btn btn-sm btn-ghost" data-do="pay-reject">Reject</button>' : ''}
              ${b.payment_status !== 'paid' ? '<button class="btn btn-sm btn-ghost" data-do="pay-paid">Mark fully paid</button>' : ''}
            </div></td>
          <td><span class="badge ${b.status}">${b.status}</span>
            ${b.change_type ? `<div class="note-box" style="margin-top:.5rem">${b.change_type === 'cancel' ? 'Wants to cancel' : `Wants ${fmtDate(b.new_date)} at ${fmtTime(b.new_start_time)}`}</div>` : ''}</td>
          <td><select data-assign>${'<option value="">Unassigned</option>' + staff.map((s) => `<option value="${s.id}" ${s.id === b.assigned_to ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></td>
          <td><div class="actions-row">
            ${b.status === 'pending' ? '<button class="btn btn-sm" data-do="approve">Approve</button><button class="btn btn-sm btn-ghost" data-do="reject">Reject</button>' : ''}
            ${b.change_type ? '<button class="btn btn-sm" data-do="chg-approve">Accept change</button><button class="btn btn-sm btn-ghost" data-do="chg-reject">Decline</button>' : ''}
          </div></td></tr>`).join('')}
        </tbody></table></div>`;
    } catch (e) { toast(e.message, true); }
  }
  $('status-filter').onchange = loadReservations;

  async function viewProof(id) {
    try {
      const { image } = await api(`/admin/bookings/${id}/proof`);
      const o = document.createElement('div');
      o.className = 'overlay dark';
      o.innerHTML = `<figure class="lb"><img src="${image}" alt="Payment screenshot"><figcaption><strong>Booking #${id} payment proof</strong><button class="btn btn-sm btn-ghost" type="button">Close</button></figcaption></figure>`;
      o.onclick = (e) => { if (e.target === o || e.target.closest('button')) o.remove(); };
      document.body.appendChild(o);
    } catch (e) { toast(e.message, true); }
  }

  $('res-table').onclick = (e) => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    const id = b.closest('tr').dataset.id, d = b.dataset.do, row = rowMap[id] || {};
    const pay = (action, msg) => act(() => api(`/admin/bookings/${id}/payment`, { method: 'POST', body: { action } }), msg, loadReservations);
    if (d === 'proof') return viewProof(id);
    if (d === 'pay-verify') return pay('verify_deposit', 'Deposit recorded.');
    if (d === 'pay-paid') return pay('mark_paid', 'Marked as fully paid.');
    if (d === 'pay-reject') return pay('reject', 'Payment rejected. The client was notified.');
    if (d === 'approve' && ['unpaid', 'proof_sent'].includes(row.payment_status) && !confirm('The reservation fee has not been verified yet. Approve anyway?')) return;
    if (d === 'approve' || d === 'reject')
      act(() => api(`/admin/bookings/${id}/decision`, { method: 'POST', body: { action: d } }), d === 'approve' ? 'Booking approved.' : 'Booking rejected.', loadReservations);
    else
      act(() => api(`/admin/bookings/${id}/change`, { method: 'POST', body: { decision: d === 'chg-approve' ? 'approve' : 'reject' } }), 'Change request updated.', loadReservations);
  };
  $('res-table').onchange = (e) => {
    if (!e.target.matches('[data-assign]')) return;
    const id = e.target.closest('tr').dataset.id;
    act(() => api(`/admin/bookings/${id}/assign`, { method: 'POST', body: { staff_id: e.target.value } }), 'Assignment saved.');
  };

  /* ---- Services, hours & holidays (admin) ---- */
  async function loadManage() {
    if (!isAdmin) return;
    try {
      const [pk, st, bl] = await Promise.all([api('/admin/packages'), api('/admin/settings'), api('/admin/blocked')]);
      $('pkg-admin').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Package</th><th>Price (₱)</th><th>Duration (hrs)</th><th>Active</th><th></th></tr></thead><tbody>
        ${pk.map((p) => `<tr data-id="${p.id}"><td><strong>${esc(p.name)}</strong></td>
          <td><input type="number" min="0" data-f="price" value="${p.price}"></td>
          <td><input type="number" min="1" data-f="hours" value="${p.hours}"></td>
          <td><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''}></td>
          <td><button class="btn btn-sm" data-save="pkg">Save</button></td></tr>`).join('')}</tbody></table></div>`;
      $('s-crews').value = st.crews; $('s-deposit').value = st.deposit_percent; $('s-instructions').value = st.payment_instructions;
      $('blocked-list').innerHTML = bl.length ? bl.map((b) => `<div class="addon-row"><span>${fmtDate(b.date)}${b.reason ? ' — ' + esc(b.reason) : ''}</span>
        <button class="btn btn-sm btn-ghost" data-unblock="${b.date}">Remove</button></div>`).join('') : '<p class="muted small">No blocked dates.</p>';
    } catch (e) { toast(e.message, true); }
  }

  const rowData = (tr) => {
    const o = {};
    tr.querySelectorAll('[data-f]').forEach((i) => (o[i.dataset.f] = i.type === 'checkbox' ? i.checked : Number(i.value)));
    return o;
  };
  $('tab-manage').onclick = (e) => {
    const s = e.target.closest('[data-save]');
    if (s) { const tr = s.closest('tr'); return act(() => api('/admin/packages/' + tr.dataset.id, { method: 'PUT', body: rowData(tr) }), 'Saved.'); }
    const u = e.target.closest('[data-unblock]');
    if (u) act(() => api('/admin/blocked/' + u.dataset.unblock, { method: 'DELETE' }), 'Date unblocked.', loadManage);
  };

  $('settings-form').onsubmit = (e) => { e.preventDefault();
    act(() => api('/admin/settings', { method: 'PUT', body: { crews: Number($('s-crews').value), deposit_percent: Number($('s-deposit').value), payment_instructions: $('s-instructions').value } }), 'Settings saved.'); };
  $('block-form').onsubmit = (e) => { e.preventDefault();
    act(() => api('/admin/blocked', { method: 'POST', body: { date: $('bd-date').value, reason: $('bd-reason').value } }), 'Date blocked.', () => { e.target.reset(); loadManage(); }); };
  $('staff-form').onsubmit = (e) => { e.preventDefault();
    act(() => api('/admin/staff', { method: 'POST', body: { name: $('sf-name').value, email: $('sf-email').value, password: $('sf-pass').value } }), 'Staff account created.', () => { e.target.reset(); staff = []; }); };

  loadDash();
})();
