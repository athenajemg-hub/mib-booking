require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const packages = [
  ["Agent's Package", 7800, '50–100', 3, ['3 hours unlimited prints', '1 photographer + 1 editor', '1 frame layout (FREE design)', 'Soft copy turnover']],
  ["Director's Package", 8500, '100–150', 4, ['4 hours unlimited prints', '1 photographer + 1 editor', '1 frame layout (FREE design)', '1 A4 framed photo', 'Basic photo coverage', 'Soft copy turnover']],
  ["Governor's Package", 11900, '150–250', 5, ['5 hours unlimited prints', 'Ceremony & Reception photoman', '2 photographers + 1 editor', '2 frame layouts (FREE design)', '1 A4 framed photo', '20 magnetic photos', 'Basic photo coverage', 'Soft copy turnover']],
  ['Secret Service Package', 19800, '250–400', 6, ['6 hours unlimited prints', 'Ceremony & Reception photoman', '3 photographers + 2 editors', '1 distribution assistant', '3 frame layouts (FREE design)', '1 A4 framed photo', '20 magnetic photos', 'Basic photo coverage', 'Per table coverage', 'Soft copy turnover']],
];

// [name, price, unit, note]
const addons = [
  ["Agent's Extension", 2000, 'flat', null],
  ["Director's Extension", 2500, 'flat', null],
  ["Governor's Extension", 3000, 'flat', null],
  ['Secret Service Extension', 5000, 'flat', null],
  ['Unlimited Magnet', 1000, 'hr', null],
  ['5R Size Upgrade', 1000, 'hr', null],
  ['Additional Layout', 1000, 'flat', null],
  ['Distribution Assistant', 1200, 'flat', null],
  ['A4 Framed Photo', 800, 'flat', null],
  ['20-page Guestbook', 6000, 'flat', null],
  ['Event Photo Coverage', 8000, 'flat', null],
  ['After Party Coverage', 6000, 'flat', null],
  ['Lights Set-up', 8000, 'flat', null],
  ['6hrs Content Creator', 8500, 'flat', null],
  ['Per Table Prints', 5000, 'flat', 'Priced ₱5,000–₱8,000'],
];

const settings = [['crews', '1'], ['deposit_percent', '30'], ['payment_instructions', 'Payment details will be sent by our team. You can also message us at hello@mibphotoman.com.']];

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));

  if (!(await pool.query('SELECT 1 FROM packages LIMIT 1')).rowCount) {
    for (const [i, p] of packages.entries())
      await pool.query('INSERT INTO packages(name,price,pax_range,hours,inclusions,sort_order) VALUES($1,$2,$3,$4,$5,$6)', [...p, i]);
  }
  if (!(await pool.query('SELECT 1 FROM addons LIMIT 1')).rowCount) {
    for (const a of addons) await pool.query('INSERT INTO addons(name,price,unit,note) VALUES($1,$2,$3,$4)', a);
  }
  for (const [k, v] of settings)
    await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);

  const users = [
    ['MIB Admin', 'admin@mib.com', 'Admin@12345', 'admin'],
    ['MIB Staff', 'staff@mib.com', 'Staff@12345', 'staff'],
  ];
  for (const [name, email, pw, role] of users) {
    await pool.query(
      'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING',
      [name, email, await bcrypt.hash(pw, 10), role]
    );
  }

  console.log('Database ready.\n  Admin: admin@mib.com / Admin@12345\n  Staff: staff@mib.com / Staff@12345');
  await pool.end();
})().catch((e) => {
  console.error('Database setup failed:', e.message);
  process.exit(1);
});
