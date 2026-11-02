const router = require('express').Router();
const { query } = require('../db');
const { wrap, LAYOUTS, getSettings, toMin, checkFuture, reserveCheck } = require('../lib');

router.get('/packages', wrap(async (req, res) => {
  res.json((await query('SELECT * FROM packages WHERE active ORDER BY sort_order, id')).rows);
}));

router.get('/addons', wrap(async (req, res) => {
  res.json((await query('SELECT * FROM addons WHERE active ORDER BY id')).rows);
}));

router.get('/layouts', (req, res) => res.json(LAYOUTS));

router.get('/settings', wrap(async (req, res) => res.json(await getSettings())));

const nextDay = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

// Busy time windows (minutes from midnight) per date + blocked dates for one month
router.get('/availability', wrap(async (req, res) => {
  const m = req.query.month;
  if (!/^\d{4}-\d{2}$/.test(m || '')) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const start = `${m}-01`;
  const [bk, bl] = await Promise.all([
    query(`SELECT event_date, start_time, hours FROM bookings
           WHERE status IN ('pending','approved') AND hours IS NOT NULL AND start_time IS NOT NULL
             AND event_date >= ($1::date - 1) AND event_date < ($1::date + INTERVAL '1 month')`, [start]),
    query(`SELECT date, reason FROM blocked_dates
           WHERE date >= $1::date AND date < ($1::date + INTERVAL '1 month')`, [start]),
  ]);
  const busy = {}, blocked = {};
  bk.rows.forEach((r) => {
    const s = toMin(r.start_time), e = s + r.hours * 60;
    (busy[r.event_date] ||= []).push([s, e]);
    if (e > 1440) (busy[nextDay(r.event_date)] ||= []).push([s - 1440, e - 1440]); // event runs past midnight
  });
  bl.rows.forEach((r) => (blocked[r.date] = r.reason || 'Unavailable'));
  res.json({ busy, blocked });
}));

// Live check for a chosen date + start time
router.get('/availability/check', wrap(async (req, res) => {
  const { date, time } = req.query;
  const hours = parseInt(req.query.hours) || 3;
  const dErr = checkFuture(date);
  if (dErr) return res.json({ ok: false, error: dErr });
  const err = await reserveCheck({ query }, date, time, hours);
  res.json(err ? { ok: false, error: err } : { ok: true });
}));

module.exports = router;
