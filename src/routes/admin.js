const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { wrap, bail, getSettings, BOOKING_SELECT, reserveCheck, notifyBooking } = require('../lib');

const validName = (value) => typeof value === 'string' && value.trim().length >= 20 && value.trim().length <= 40;
const validPassword = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 16;

router.use(auth, requireRole('staff', 'admin'));
const adminOnly = requireRole('admin');

let auditTableReady;
async function ensureAuditTable() {
  if (!auditTableReady) {
    auditTableReady = query(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id INT REFERENCES users(id) ON DELETE SET NULL,
        actor_name VARCHAR(120) NOT NULL,
        actor_role VARCHAR(10) NOT NULL,
        action VARCHAR(80) NOT NULL,
        entity_type VARCHAR(40) NOT NULL,
        entity_id INT,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_logs(entity_type, entity_id);
    `);
  }
  return auditTableReady;
}

async function recordAudit(req, action, entityType, entityId, details = {}) {
  try {
    await ensureAuditTable();
    await query(
      `INSERT INTO admin_audit_logs(actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [req.user.id, req.user.name || 'Unknown user', req.user.role, action, entityType, entityId || null, JSON.stringify(details)]
    );
  } catch (err) {
    // Audit failures must not reverse an action that has already succeeded.
    console.error('Audit log write failed:', err.message);
  }
}

/* ---------- Reservations & approval workflow (staff + admin) ---------- */

router.get('/bookings', wrap(async (req, res) => {
  const { status } = req.query;
  let where = '';
  const params = [];
  if (status === 'changes') where = 'WHERE b.change_type IS NOT NULL';
  else if (status) { where = 'WHERE b.status=$1'; params.push(status); }
  const { rows } = await query(`${BOOKING_SELECT} ${where} ORDER BY b.event_date DESC, b.start_time DESC`, params);
  res.json(rows);
}));

router.get('/audit-logs', adminOnly, wrap(async (req, res) => {
  await ensureAuditTable();
  const { rows } = await query(
    `SELECT id, actor_name, actor_role, action, entity_type, entity_id, details, created_at
     FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200`
  );
  res.json(rows);
}));

router.get('/staff', wrap(async (req, res) => {
  const { rows } = await query(`SELECT id, name, role FROM users WHERE role IN ('staff','admin') ORDER BY name`);
  res.json(rows);
}));

router.post('/bookings/:id/decision', wrap(async (req, res) => {
  const { action } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });
  const id = +req.params.id;
  const r = await query(`UPDATE bookings SET status=$1 WHERE id=$2 AND status='pending' RETURNING id`,
    [action === 'approve' ? 'approved' : 'rejected', id]);
  if (!r.rowCount) return res.status(409).json({ error: 'Only pending bookings can be approved or rejected.' });
  await recordAudit(req, action === 'approve' ? 'booking.approved' : 'booking.rejected', 'booking', id);
  notifyBooking(id, action === 'approve'
    ? 'Great news! Your booking has been approved.'
    : 'Unfortunately, we are unable to accept your booking request.').catch(console.error);
  res.json({ ok: true });
}));

router.post('/bookings/:id/assign', wrap(async (req, res) => {
  const staffId = req.body.staff_id ? +req.body.staff_id : null;
  await query('UPDATE bookings SET assigned_to=$1 WHERE id=$2', [staffId, +req.params.id]);
  res.json({ ok: true });
}));

// Approve / decline a customer's cancel or reschedule request
router.post('/bookings/:id/change', wrap(async (req, res) => {
  const { decision } = req.body;
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  const id = +req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [b] } = await client.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [id]);
    if (!b || !b.change_type) return await bail(client, res, 409, 'There is no pending change request.');
    let headline;
    const clear = 'change_type=NULL, new_date=NULL, new_start_time=NULL';
    if (decision === 'approve' && b.change_type === 'cancel') {
      await client.query(`UPDATE bookings SET status='cancelled', ${clear} WHERE id=$1`, [id]);
      headline = 'Your cancellation request has been approved.';
    } else if (decision === 'approve') {
      const err = await reserveCheck(client, b.new_date, b.new_start_time, b.hours || 3, id);
      if (err) return await bail(client, res, 409, err);
      await client.query(`UPDATE bookings SET event_date=new_date, start_time=new_start_time, ${clear} WHERE id=$1`, [id]);
      headline = 'Your reschedule request has been approved.';
    } else {
      await client.query(`UPDATE bookings SET ${clear} WHERE id=$1`, [id]);
      headline = 'Your change request was declined. Your original booking stays as it is.';
    }
    await client.query('COMMIT');
    notifyBooking(id, headline).catch(console.error);
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

// Staff verify (or reject) a client's payment, or record one received in person
router.post('/bookings/:id/payment', wrap(async (req, res) => {
  const { action } = req.body;
  const id = +req.params.id;
  const { rows: [b] } = await query('SELECT * FROM bookings WHERE id=$1', [id]);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  let headline;
  if (action === 'verify_deposit') {
    const paid = Math.min(Number(b.payment_claimed) || Number(b.deposit_amount) || 0, Number(b.total));
    if (!(paid > 0)) return res.status(400).json({ error: 'There is no amount to verify.' });
    const status = paid >= b.total ? 'paid' : 'deposit_paid';
    await query('UPDATE bookings SET amount_paid=$1, payment_status=$2 WHERE id=$3', [paid, status, id]);
    headline = status === 'paid' ? 'Payment received in full. Thank you!' : `Deposit of ₱${paid.toLocaleString('en-PH')} received. Thank you!`;
  } else if (action === 'mark_paid') {
    await query(`UPDATE bookings SET amount_paid=total, payment_status='paid' WHERE id=$1`, [id]);
    headline = 'Payment received in full. Thank you!';
  } else if (action === 'reject') {
    await query(`UPDATE bookings SET payment_status='unpaid', payment_claimed=NULL, payment_ref=NULL, payment_method=NULL WHERE id=$1`, [id]);
    await query('DELETE FROM payment_proofs WHERE booking_id=$1', [id]);
    headline = "We couldn't verify your payment. Please check the details and submit them again.";
  } else return res.status(400).json({ error: 'Invalid action.' });
  notifyBooking(id, headline).catch(console.error);
  res.json({ ok: true });
}));

router.get('/bookings/:id/proof', wrap(async (req, res) => {
  const { rows: [p] } = await query('SELECT image FROM payment_proofs WHERE booking_id=$1', [+req.params.id]);
  if (!p) return res.status(404).json({ error: 'No screenshot was uploaded.' });
  res.json({ image: p.image });
}));

/* ---------- Dashboard & analytics ---------- */

router.get('/analytics', wrap(async (req, res) => {
  const [totals, hours, months, pkgs, layouts] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status='pending')::int AS pending,
             COUNT(*) FILTER (WHERE status='approved')::int AS approved,
             COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
             COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,
             COALESCE(SUM(total) FILTER (WHERE status='approved'), 0) AS revenue,
             COALESCE(SUM(amount_paid), 0) AS collected
           FROM bookings`),
    query(`SELECT EXTRACT(HOUR FROM start_time)::int AS h, COUNT(*)::int AS n FROM bookings
           WHERE status IN ('pending','approved') AND start_time IS NOT NULL GROUP BY h ORDER BY h`),
    query(`SELECT to_char(event_date, 'YYYY-MM') AS label, COUNT(*)::int AS n FROM bookings
           WHERE status IN ('pending','approved') GROUP BY 1 ORDER BY 1 DESC LIMIT 6`),
    query(`SELECT p.name AS label, COUNT(b.id)::int AS n FROM packages p
           LEFT JOIN bookings b ON b.package_id = p.id AND b.status IN ('pending','approved')
           GROUP BY p.id ORDER BY p.sort_order`),
    query(`SELECT layout AS label, COUNT(*)::int AS n FROM bookings
           WHERE status IN ('pending','approved') AND layout IS NOT NULL GROUP BY layout ORDER BY n DESC`),
  ]);
  const t = totals.rows[0];
  res.json({
    ...t,
    cancellation_rate: t.total ? Math.round((t.cancelled / t.total) * 1000) / 10 : 0,
    by_hour: hours.rows.map((r) => ({ label: `${((r.h + 11) % 12) + 1} ${r.h >= 12 ? 'PM' : 'AM'}`, n: r.n })),
    by_month: months.rows.reverse(),
    by_package: pkgs.rows,
    by_layout: layouts.rows,
  });
}));

/* ---------- Services, capacity & holidays (admin only) ---------- */

router.get('/packages', adminOnly, wrap(async (req, res) => {
  res.json((await query('SELECT * FROM packages ORDER BY sort_order, id')).rows);
}));

router.put('/packages/:id', adminOnly, wrap(async (req, res) => {
  const { price, hours, active } = req.body;
  if (!(price >= 0) || !(hours > 0)) return res.status(400).json({ error: 'Enter a valid price and duration.' });
  await query('UPDATE packages SET price=$1, hours=$2, active=$3 WHERE id=$4', [price, hours, !!active, +req.params.id]);
  res.json({ ok: true });
}));

router.get('/settings', adminOnly, wrap(async (req, res) => res.json(await getSettings())));

router.put('/settings', adminOnly, wrap(async (req, res) => {
  const crews = Math.floor(Number(req.body.crews));
  const pct = Number(req.body.deposit_percent);
  const instructions = String(req.body.payment_instructions || '').trim().slice(0, 600);
  if (!(crews >= 1)) return res.status(400).json({ error: 'Crews must be 1 or more.' });
  if (!(pct >= 0 && pct <= 100)) return res.status(400).json({ error: 'Reservation fee must be between 0 and 100 percent.' });
  const entries = { crews: String(crews), deposit_percent: String(pct), payment_instructions: instructions };
  for (const [k, v] of Object.entries(entries))
    await query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  res.json({ ok: true });
}));

router.get('/blocked', adminOnly, wrap(async (req, res) => {
  res.json((await query('SELECT date, reason FROM blocked_dates WHERE date >= CURRENT_DATE - 1 ORDER BY date')).rows);
}));

router.post('/blocked', adminOnly, wrap(async (req, res) => {
  const { date, reason } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Choose a date.' });
  await query('INSERT INTO blocked_dates(date,reason) VALUES($1,$2) ON CONFLICT (date) DO UPDATE SET reason=$2', [date, reason || null]);
  res.status(201).json({ ok: true });
}));

router.delete('/blocked/:date', adminOnly, wrap(async (req, res) => {
  await query('DELETE FROM blocked_dates WHERE date=$1', [req.params.date]);
  res.json({ ok: true });
}));

router.post('/staff', adminOnly, wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!validName(name) || !/^\S+@\S+\.\S+$/.test(email || '') || email.length > 160 || !validPassword(password))
    return res.status(400).json({ error: 'Enter a full name of 20–40 characters, a valid email of up to 160 characters, and a password of 8–16 characters.' });
  try {
    await query(`INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'staff')`,
      [name.trim(), email.toLowerCase().trim(), await bcrypt.hash(password, 10)]);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    throw e;
  }
}));

module.exports = router;
