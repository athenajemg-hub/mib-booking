const { query } = require('./db');
const { sendMail } = require('./mailer');

const LAYOUTS = ['4R Portrait', '4R Landscape', '4R Double Landscape', '4R Polaroid Portrait', 'Filmstrip'];

// Lets async route handlers throw errors safely
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- time helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => { n = ((n % 1440) + 1440) % 1440; return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`; };
const fmt12 = (t) => { const m = toMin(t), h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${pad(m % 60)} ${h >= 12 ? 'PM' : 'AM'}`; };

// 'YYYY-MM-DD' in Philippine time, offset by N days
const manilaDate = (offset = 0) =>
  new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function checkFuture(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || isNaN(new Date(d))) return 'Please choose a valid date.';
  if (d <= manilaDate(0)) return 'Please choose a future date.';
  return null;
}

async function bail(client, res, code, error) {
  await client.query('ROLLBACK');
  return res.status(code).json({ error });
}

const DEFAULT_PAYMENT = 'Payment details will be sent by our team. You can also message us at hello@mibphotoman.com.';

async function getSettings(db = { query }) {
  const { rows } = await db.query("SELECT key, value FROM settings WHERE key IN ('crews','deposit_percent','payment_instructions')");
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const pct = parseFloat(m.deposit_percent);
  return {
    crews: parseInt(m.crews) || 1,
    deposit_percent: Number.isFinite(pct) ? pct : 30,
    payment_instructions: m.payment_instructions || DEFAULT_PAYMENT,
  };
}

const BOOKING_SELECT = `
  SELECT b.*, p.name AS package_name, p.price AS package_price,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone, u.notify_email,
         st.name AS staff_name,
         EXISTS (SELECT 1 FROM payment_proofs pp WHERE pp.booking_id = b.id) AS has_proof,
         COALESCE((SELECT json_agg(json_build_object('name', a.name, 'qty', ba.qty, 'price', ba.price))
                   FROM booking_addons ba JOIN addons a ON a.id = ba.addon_id
                   WHERE ba.booking_id = b.id), '[]'::json) AS addons
  FROM bookings b
  JOIN packages p ON p.id = b.package_id
  JOIN users u ON u.id = b.user_id
  LEFT JOIN users st ON st.id = b.assigned_to
`;

// Clients may choose any start time; only the format is checked
function checkTime(time) {
  const m = /^(\d{2}):(\d{2})/.exec(time || '');
  if (!m || +m[1] > 23 || +m[2] > 59) return 'Please choose a valid start time.';
  return null;
}

// Checks the time format, holidays and overlapping events (limited by the number of crews).
// Inside a transaction the advisory lock serialises bookings, so two people can't grab the same time.
async function reserveCheck(db, date, time, hours, excludeId = 0) {
  await db.query('SELECT pg_advisory_xact_lock(7771)');
  const s = await getSettings(db);
  const tErr = checkTime(time);
  if (tErr) return tErr;
  const b = await db.query('SELECT reason FROM blocked_dates WHERE date=$1', [date]);
  if (b.rowCount) return 'That date is unavailable' + (b.rows[0].reason ? ` (${b.rows[0].reason})` : '') + '.';
  const c = await db.query(
    `SELECT COUNT(*)::int AS n FROM bookings
     WHERE status IN ('pending','approved') AND id <> $3
       AND (event_date + start_time) < ($1::timestamp + $2::int * INTERVAL '1 hour')
       AND (event_date + start_time + hours * INTERVAL '1 hour') > $1::timestamp`,
    [`${date} ${String(time).slice(0, 5)}`, hours, excludeId]
  );
  if (c.rows[0].n >= s.crews) return 'That time overlaps with another booking. Please choose a different time.';
  return null;
}

const whenText = (b) => {
  const start = String(b.start_time).slice(0, 5);
  return `${b.event_date}, ${fmt12(start)} - ${fmt12(fromMin(toMin(start) + (b.hours || 0) * 60))}`;
};

// Tells the CLIENT: an in-site notification (always) + an email (if they allow emails)
async function notifyBooking(id, headline) {
  const { rows } = await query(`${BOOKING_SELECT} WHERE b.id=$1`, [id]);
  const b = rows[0];
  if (!b) return;
  await query('INSERT INTO notifications(user_id,title,body,link) VALUES($1,$2,$3,$4)',
    [b.user_id, headline.slice(0, 160), `Booking #${b.id} · ${b.package_name} · ${b.event_date}`, '/bookings.html']);
  if (!b.notify_email) return;
  const text =
    `Hi ${b.customer_name},\n\n${headline}\n\n` +
    `Booking #${b.id}\nPackage: ${b.package_name}\nLayout: ${b.layout || '-'}\n` +
    `Date: ${whenText(b)}\nVenue: ${b.venue}\nStatus: ${b.status.toUpperCase()}\nTotal: PHP ${Number(b.total).toLocaleString('en-PH')}\n\n` +
    `Thank you,\nMIB Photoman`;
  await sendMail(b.customer_email, `MIB Photoman - Booking #${b.id}`, text);
}

// Tells STAFF + ADMINS: an in-site notification, plus an email to STAFF_NOTIFY_EMAIL (if set)
async function notifyStaff(id, headline) {
  const { rows } = await query(`${BOOKING_SELECT} WHERE b.id=$1`, [id]);
  const b = rows[0];
  if (!b) return;
  await query(
    `INSERT INTO notifications(user_id,title,body,link)
     SELECT id, $1, $2, '/admin.html' FROM users WHERE role IN ('staff','admin')`,
    [headline.slice(0, 160), `${b.customer_name} · ${b.package_name} · ${b.event_date}`]);
  const to = (process.env.STAFF_NOTIFY_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!to.length) return;
  const link = process.env.APP_URL ? `\nOpen the admin page: ${process.env.APP_URL.replace(/\/$/, '')}/admin.html\n` : '';
  const text =
    `${headline}\n\nBooking #${b.id}\nCustomer: ${b.customer_name} (${b.customer_email}, ${b.customer_phone || 'no phone'})\n` +
    `Package: ${b.package_name}\nLayout: ${b.layout || '-'}\nDate: ${whenText(b)}\nVenue: ${b.venue}\n` +
    `Total: PHP ${Number(b.total).toLocaleString('en-PH')}\nStatus: ${b.status.toUpperCase()}\n${link}`;
  for (const addr of to) await sendMail(addr, `MIB Photoman - ${headline} (#${b.id})`, text);
}

// Public address of the site (for links in emails)
const baseUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

module.exports = { LAYOUTS, wrap, manilaDate, checkFuture, bail, getSettings, toMin, fromMin, fmt12, BOOKING_SELECT, reserveCheck, notifyBooking, notifyStaff, baseUrl };
