require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const { query } = require('./src/db');
const { notifyBooking, manilaDate } = require('./src/lib');

if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  console.error('Missing JWT_SECRET or DATABASE_URL. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // behind Render's proxy, so links use https
app.use(express.json({ limit: '1mb' })); // payment screenshots are compressed in the browser first
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/bookings', require('./src/routes/bookings'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/public'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Daily 8:00 AM (Manila): remind customers of events happening tomorrow
cron.schedule(
  '0 8 * * *',
  async () => {
    try {
      const { rows } = await query(
        `SELECT id FROM bookings WHERE status='approved' AND event_date=$1 AND reminder_sent=FALSE`,
        [manilaDate(1)]
      );
      for (const r of rows) {
        await notifyBooking(r.id, 'Friendly reminder: your event is tomorrow!');
        await query('UPDATE bookings SET reminder_sent=TRUE WHERE id=$1', [r.id]);
      }
      await query("DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '60 days'");
    } catch (e) {
      console.error('Reminder job failed:', e.message);
    }
  },
  { timezone: 'Asia/Manila' }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MIB Booking running at http://localhost:${PORT}`));
