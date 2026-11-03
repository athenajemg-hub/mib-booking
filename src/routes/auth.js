const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { sign, auth } = require('../middleware/auth');
const { sendMail, emailConfigured } = require('../mailer');
const { wrap, baseUrl } = require('../lib');

const pub = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, notify_email: u.notify_email, email_verified: u.email_verified });

async function sendVerification(req, user, token) {
  const link = `${baseUrl(req)}/api/auth/verify?token=${token}`;
  await sendMail(user.email, 'Confirm your email - MIB Photoman',
    `Hi ${user.name},\n\nWelcome to MIB Photoman! Please confirm your email address so you can start booking:\n\n${link}\n\n` +
    `If you didn't create this account, you can ignore this email.\n\nMIB Photoman`);
}

router.post('/register', wrap(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name?.trim() || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  // Email confirmation is only required when the site can actually send email
  const needsVerify = emailConfigured();
  const token = needsVerify ? crypto.randomBytes(32).toString('hex') : null;
  try {
    const { rows } = await query(
      `INSERT INTO users(name,email,phone,password_hash,email_verified,verify_token,verify_sent_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name.trim(), email.toLowerCase().trim(), phone || null, await bcrypt.hash(password, 10), !needsVerify, token, needsVerify ? new Date() : null]
    );
    if (needsVerify) sendVerification(req, rows[0], token).catch(console.error);
    res.status(201).json({ token: sign(rows[0]), user: pub(rows[0]), verify_sent: needsVerify });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    throw e;
  }
}));

// Link from the confirmation email
router.get('/verify', wrap(async (req, res) => {
  const token = String(req.query.token || '');
  const r = /^[a-f0-9]{64}$/.test(token)
    ? await query('UPDATE users SET email_verified=TRUE, verify_token=NULL WHERE verify_token=$1 RETURNING id', [token])
    : { rowCount: 0 };
  res.redirect(r.rowCount ? '/login.html?verified=1' : '/login.html?verify=invalid');
}));

router.post('/resend-verification', auth, wrap(async (req, res) => {
  const { rows: [u] } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!u) return res.status(401).json({ error: 'Account not found.' });
  if (u.email_verified) return res.json({ message: 'Your email is already confirmed.' });
  if (!emailConfigured()) return res.status(503).json({ error: 'Email sending is not set up yet. Please contact us.' });
  if (u.verify_sent_at && Date.now() - new Date(u.verify_sent_at).getTime() < 60000)
    return res.status(429).json({ error: 'Please wait a minute before asking for another email.' });
  const token = crypto.randomBytes(32).toString('hex');
  await query('UPDATE users SET verify_token=$1, verify_sent_at=NOW() WHERE id=$2', [token, u.id]);
  await sendVerification(req, u, token);
  res.json({ message: 'Confirmation email sent. Please check your inbox (and spam folder).' });
}));

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Step 1: ask for a reset link. The answer is always the same, so nobody can probe which emails exist.

router.post('/forgot', wrap(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({
      error: 'Please enter a valid email address.'
    });
  }

  if (!emailConfigured()) {
    console.error('Password reset email unavailable: email is not configured.');
    return res.status(503).json({
      error: 'Password reset is temporarily unavailable. Please contact us.'
    });
  }

  const { rows: [u] } = await query(
    'SELECT * FROM users WHERE email=$1',
    [email]
  );

  const sentRecently = u && u.reset_expires &&
    new Date(u.reset_expires).getTime() - 3600000 + 60000 > Date.now();

  if (u && !sentRecently) {
    const token = crypto.randomBytes(32).toString('hex');

    await query(
      "UPDATE users SET reset_token_hash=$1, reset_expires=NOW() + INTERVAL '1 hour' WHERE id=$2",
      [sha(token), u.id]
    );

    const sent = await sendMail(
      u.email,
      'Reset your password - MIB Photoman',
      `Hi ${u.name},\n\nWe received a request to reset your password. Open this link to choose a new one (valid for 1 hour):\n\n` +
      `${baseUrl(req)}/reset.html?token=${token}\n\nIf you didn't ask for this, you can ignore this email and your password will stay the same.\n\nMIB Photoman`
    );

    if (!sent) {
      console.error('Password reset email could not be sent.');
    }
  }

  res.json({
    message: 'If that email is registered, we sent a link to reset your password. It expires in 1 hour.'
  });
}));


// Step 2: choose a new password with the link from the email
router.post('/reset', wrap(async (req, res) => {
  const { token, password } = req.body;
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return res.status(400).json({ error: 'This reset link is not valid.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const r = await query(
    `UPDATE users SET password_hash=$1, reset_token_hash=NULL, reset_expires=NULL, email_verified=TRUE
     WHERE reset_token_hash=$2 AND reset_expires > NOW() RETURNING id`,
    [await bcrypt.hash(password, 10), sha(token)]);
  if (!r.rowCount) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  res.json({ message: 'Password updated. You can now log in.' });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query('SELECT * FROM users WHERE email=$1', [String(email || '').toLowerCase().trim()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash)))
    return res.status(401).json({ error: 'Incorrect email or password.' });
  res.json({ token: sign(u), user: pub(u) });
}));

router.get('/me', auth, wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Account not found.' });
  res.json({ user: pub(rows[0]) });
}));

router.put('/me', auth, wrap(async (req, res) => {
  const { name, phone, notify_email, new_password } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  let hash = null;
  if (new_password) {
    if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    hash = await bcrypt.hash(new_password, 10);
  }
  const { rows } = await query(
    `UPDATE users SET name=$1, phone=$2, notify_email=$3, password_hash=COALESCE($4, password_hash)
     WHERE id=$5 RETURNING *`,
    [name.trim(), phone || null, notify_email !== false, hash, req.user.id]
  );
  res.json({ user: pub(rows[0]), token: sign(rows[0]) });
}));

module.exports = router;
