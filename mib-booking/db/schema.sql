CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  phone VARCHAR(40),
  password_hash TEXT NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
  notify_email BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  verify_token VARCHAR(64),
  verify_sent_at TIMESTAMPTZ,
  reset_token_hash VARCHAR(64),
  reset_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade path: existing accounts count as verified so nobody gets locked out
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_sent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS packages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  pax_range VARCHAR(30) NOT NULL,
  hours INT NOT NULL,
  inclusions TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS addons (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  unit VARCHAR(10) NOT NULL DEFAULT 'flat' CHECK (unit IN ('flat','hr')),
  note VARCHAR(80),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Booking rules: open_time, close_time, crews (events that can run at the same time), step (minutes)
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(40) PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE settings ALTER COLUMN value TYPE TEXT;

CREATE TABLE IF NOT EXISTS blocked_dates (
  date DATE PRIMARY KEY,
  reason VARCHAR(120)
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id INT NOT NULL REFERENCES packages(id),
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  hours INT NOT NULL,
  layout VARCHAR(40),
  event_type VARCHAR(60) NOT NULL,
  venue VARCHAR(200) NOT NULL,
  guests INT,
  notes TEXT,
  total NUMERIC(10,2) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
  change_type VARCHAR(12) CHECK (change_type IN ('cancel','reschedule')),
  new_date DATE,
  new_start_time TIME,
  deposit_amount NUMERIC(10,2),
  amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','proof_sent','deposit_paid','paid')),
  payment_method VARCHAR(30),
  payment_ref VARCHAR(80),
  payment_claimed NUMERIC(10,2),
  reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade path for databases created by the first version (fixed time slots)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hours INT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS layout VARCHAR(40);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS new_start_time TIME;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','proof_sent','deposit_paid','paid'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(80);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_claimed NUMERIC(10,2);
UPDATE bookings SET deposit_amount = ROUND(total * 0.3) WHERE deposit_amount IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'slot_id') THEN
    EXECUTE 'ALTER TABLE bookings ALTER COLUMN slot_id DROP NOT NULL';
    EXECUTE 'UPDATE bookings b SET start_time = s.start_time FROM time_slots s WHERE b.slot_id = s.id AND b.start_time IS NULL';
  END IF;
END $$;
UPDATE bookings b SET hours = p.hours FROM packages p WHERE b.package_id = p.id AND b.hours IS NULL;

UPDATE bookings SET layout = '4R Polaroid Portrait' WHERE layout = '4R Double Portrait';

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(event_date);

-- Optional screenshot a client uploads as proof of payment (stored compressed, one per booking)
CREATE TABLE IF NOT EXISTS payment_proofs (
  booking_id INT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  image TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(300),
  link VARCHAR(120),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_addons (
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id INT NOT NULL REFERENCES addons(id),
  qty INT NOT NULL DEFAULT 1,
  price NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (booking_id, addon_id)
);
