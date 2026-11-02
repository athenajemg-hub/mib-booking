const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { wrap } = require('../lib');

router.use(auth);

// Latest notifications + unread count (powers the bell in the header)
router.get('/', wrap(async (req, res) => {
  const [list, count] = await Promise.all([
    query(`SELECT id, title, body, link, is_read, created_at FROM notifications
           WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user.id]),
    query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT is_read', [req.user.id]),
  ]);
  res.json({ items: list.rows, unread: count.rows[0].n });
}));

// Mark one (body.id) or all notifications as read
router.post('/read', wrap(async (req, res) => {
  if (req.body.id) await query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2', [+req.body.id, req.user.id]);
  else await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
