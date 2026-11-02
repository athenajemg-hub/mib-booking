const nodemailer = require('nodemailer');

// Option A (works on Render's free plan): Brevo HTTPS API  -> set BREVO_API_KEY + MAIL_FROM_EMAIL
// Option B: classic SMTP                                     -> set SMTP_HOST, SMTP_USER, SMTP_PASS
// Neither set: emails are printed in the terminal.
let transport = null;
if (process.env.SMTP_HOST) {
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const emailConfigured = () => !!(process.env.BREVO_API_KEY || transport);

async function sendMail(to, subject, text) {
  if (!to) return false;

  if (process.env.BREVO_API_KEY) {
    if (!process.env.MAIL_FROM_EMAIL) {
      console.error('Email not sent: set MAIL_FROM_EMAIL to the sender address you verified in Brevo.');
      return false;
    }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: process.env.MAIL_FROM_NAME || 'MIB Photoman', email: process.env.MAIL_FROM_EMAIL },
          to: [{ email: to }],
          subject,
          textContent: text,
        }),
      });
      if (!res.ok) { console.error('Brevo email failed:', res.status, await res.text()); return false; }
      return true;
    } catch (e) {
      console.error('Email failed:', e.message);
      return false;
    }
  }

  if (transport) {
    try {
      await transport.sendMail({ from: process.env.MAIL_FROM || 'hello@mibphotoman.com', to, subject, text });
      return true;
    } catch (e) {
      console.error('Email failed:', e.message);
      return false;
    }
  }

  console.log(`\n[EMAIL -> ${to}]\nSubject: ${subject}\n${text}\n`);
  return false;
}

module.exports = { sendMail, emailConfigured };
