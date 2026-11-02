const router = require('express').Router();
const { pool, query } = require('../db');
const { auth } = require('../middleware/auth');
const { emailConfigured } = require('../mailer');
const { wrap, LAYOUTS, checkFuture, bail, BOOKING_SELECT, reserveCheck, notifyBooking, notifyStaff, getSettings } = require('../lib');

router.use(auth);

// Create a booking (checked inside a locked transaction => no double-booking)
router.post('/', wrap(async (req, res) => {
  const { package_id, event_date, start_time, layout, event_type, venue, guests, notes, addons = [] } = req.body;
  if (!package_id || !event_date || !start_time || !event_type?.trim() || !venue?.trim())
    return res.status(400).json({ error: 'Please complete all required fields.' });
  if (!LAYOUTS.includes(layout)) return res.status(400).json({ error: 'Please choose a print layout.' });
  const dateErr = checkFuture(event_date);
  if (dateErr) return res.status(400).json({ error: dateErr });

  const { rows: [me] } = await query('SELECT email_verified FROM users WHERE id=$1', [req.user.id]);
  if (me && !me.email_verified && emailConfigured())
    return res.status(403).json({ error: 'Please confirm your email before booking. Check your inbox, or resend the link from Account settings.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pkg = (await client.query('SELECT * FROM packages WHERE id=$1 AND active', [package_id])).rows[0];
    if (!pkg) return await bail(client, res, 400, 'Please choose a valid package.');

    const err = await reserveCheck(client, event_date, start_time, pkg.hours);
    if (err) return await bail(client, res, 409, err);

    let total = pkg.price;
    const lines = [];
    const seen = new Set();
    for (const a of addons) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const row = (await client.query('SELECT * FROM addons WHERE id=$1 AND active', [a.id])).rows[0];
      if (!row) continue;
      const qty = row.unit === 'hr' ? Math.min(Math.max(parseInt(a.qty) || 1, 1), 12) : 1;
      lines.push([row.id, qty, row.price]);
      total += row.price * qty;
    }

    const { deposit_percent } = await getSettings(client);
    const deposit = Math.round((total * deposit_percent) / 100);
    const ins = await client.query(
      `INSERT INTO bookings(user_id,package_id,event_date,start_time,hours,layout,event_type,venue,guests,notes,total,deposit_amount)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [req.user.id, package_id, event_date, String(start_time).slice(0, 5), pkg.hours, layout, event_type.trim(), venue.trim(), parseInt(guests) || null, notes || null, total, deposit]
    );
    const id = ins.rows[0].id;
    for (const [aid, qty, price] of lines)
      await client.query('INSERT INTO booking_addons(booking_id,addon_id,qty,price) VALUES($1,$2,$3,$4)', [id, aid, qty, price]);
    await client.query('COMMIT');

    notifyBooking(id, 'We received your booking request. Our team will review it shortly.').catch(console.error);
    notifyStaff(id, 'New booking request').catch(console.error);
    res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

// Client submits payment details (reference number + optional screenshot) for staff to verify
const METHODS = ['GCash', 'Maya', 'Bank transfer', 'Other'];
router.post('/:id/payment', wrap(async (req, res) => {
  const id = +req.params.id;
  const { method, reference, amount, proof } = req.body;
  const { rows: [b] } = await query('SELECT * FROM bookings WHERE id=$1 AND user_id=$2', [id, req.user.id]);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (!['pending', 'approved'].includes(b.status)) return res.status(409).json({ error: 'This booking is no longer active.' });
  if (b.payment_status === 'paid') return res.status(409).json({ error: 'This booking is already fully paid.' });
  if (!METHODS.includes(method)) return res.status(400).json({ error: 'Please choose how you paid.' });
  const ref = String(reference || '').trim();
  if (ref.length < 4 || ref.length > 60) return res.status(400).json({ error: 'Enter the payment reference number (at least 4 characters).' });
  const amt = Number(amount);
  if (!(amt > 0) || amt > b.total) return res.status(400).json({ error: `Enter the amount you sent (up to ₱${Number(b.total).toLocaleString('en-PH')}).` });
  if (proof && (proof.length > 900000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(proof)))
    return res.status(400).json({ error: 'The screenshot could not be used. Please try a smaller image.' });

  await query(`UPDATE bookings SET payment_status='proof_sent', payment_method=$1, payment_ref=$2, payment_claimed=$3 WHERE id=$4`, [method, ref, amt, id]);
  if (proof) await query('INSERT INTO payment_proofs(booking_id,image) VALUES($1,$2) ON CONFLICT (booking_id) DO UPDATE SET image=EXCLUDED.image, created_at=NOW()', [id, proof]);
  else await query('DELETE FROM payment_proofs WHERE booking_id=$1', [id]);
  notifyBooking(id, 'We received your payment details. Our team will verify them shortly.').catch(console.error);
  notifyStaff(id, 'Payment submitted - please verify').catch(console.error);
  res.json({ message: 'Payment details sent. We will confirm once we verify them.' });
}));

// Booking history / status tracking
router.get('/mine', wrap(async (req, res) => {
  const { rows } = await query(`${BOOKING_SELECT} WHERE b.user_id=$1 ORDER BY b.event_date DESC, b.start_time DESC`, [req.user.id]);
  res.json(rows);
}));

// Pending bookings cancel immediately; approved ones create a request for staff
router.post('/:id/cancel', wrap(async (req, res) => {
  const id = +req.params.id;
  const { rows: [b] } = await query('SELECT * FROM bookings WHERE id=$1 AND user_id=$2', [id, req.user.id]);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (!['pending', 'approved'].includes(b.status)) return res.status(409).json({ error: 'This booking can no longer be cancelled.' });
  if (b.change_type) return res.status(409).json({ error: 'You already have a change request waiting for approval.' });

  if (b.status === 'pending') {
    await query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [id]);
    notifyBooking(id, 'Your booking has been cancelled.').catch(console.error);
    notifyStaff(id, 'Booking cancelled by customer').catch(console.error);
    return res.json({ message: 'Booking cancelled.' });
  }
  await query(`UPDATE bookings SET change_type='cancel' WHERE id=$1`, [id]);
  notifyBooking(id, 'We received your cancellation request. Our team will review it.').catch(console.error);
  notifyStaff(id, 'Cancellation requested').catch(console.error);
  res.json({ message: 'Cancellation request sent for staff approval.' });
}));

router.post('/:id/reschedule', wrap(async (req, res) => {
  const id = +req.params.id;
  const { new_date, new_time } = req.body;
  const dateErr = checkFuture(new_date);
  if (dateErr) return res.status(400).json({ error: dateErr });
  if (!new_time) return res.status(400).json({ error: 'Please choose a start time.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [b] } = await client.query('SELECT * FROM bookings WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, req.user.id]);
    if (!b) return await bail(client, res, 404, 'Booking not found.');
    if (!['pending', 'approved'].includes(b.status)) return await bail(client, res, 409, 'This booking can no longer be changed.');
    if (b.change_type) return await bail(client, res, 409, 'You already have a change request waiting for approval.');
    const err = await reserveCheck(client, new_date, new_time, b.hours || 3, id);
    if (err) return await bail(client, res, 409, err);
    await client.query(`UPDATE bookings SET change_type='reschedule', new_date=$1, new_start_time=$2 WHERE id=$3`,
      [new_date, String(new_time).slice(0, 5), id]);
    await client.query('COMMIT');
    notifyBooking(id, 'We received your reschedule request. Our team will review it.').catch(console.error);
    notifyStaff(id, 'Reschedule requested').catch(console.error);
    res.json({ message: 'Reschedule request sent for staff approval.' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

module.exports = router;
