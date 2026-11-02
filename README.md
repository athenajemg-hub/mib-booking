# MIB Photoman — Booking System

Black & white photo-booth booking site.
**Frontend:** HTML5, CSS3, Vanilla JS · **Backend:** Node.js + Express.js · **Database:** PostgreSQL

## Run it in Visual Studio Code

1. **Install** Node.js 18+ and PostgreSQL.
2. **Create the database** (pgAdmin, or in a terminal):
   `createdb -U postgres mib_booking`
3. **Open this folder** in VS Code (`File > Open Folder`), then open the terminal (`Ctrl + ~`).
4. **Create your `.env`**: copy `.env.example` to `.env`, then put your PostgreSQL password in `DATABASE_URL` and change `JWT_SECRET`.
5. **Install & set up the database:**
   ```
   npm install
   npm run db:init
   ```
6. **Start the server:** `npm run dev`
7. Open **http://localhost:3000**

## Demo accounts (created by `npm run db:init`)

| Role  | Email          | Password     |
|-------|----------------|--------------|
| Admin | admin@mib.com  | Admin@12345  |
| Staff | staff@mib.com  | Staff@12345  |

Customers register on the Login page. Change the demo passwords before going live.

## Features (from the system spec)

| Module | Feature | Where |
|---|---|---|
| User Management | Registration & login, role-based access (customer / staff / admin) | `login.html`, `src/routes/auth.js` |
| User Management | Profile management | `account.html` |
| Booking | Interactive calendar with a customer-chosen start time, print layout choice, no double-booking | `book.html`, `src/lib.js` (`reserveCheck`) |
| Booking | Reservation tracking & modification (history, status tracker, cancel/reschedule requests) | `bookings.html` |
| User Management | Profile, password and notification settings (separate from My Bookings) | `account.html` |
| Administration | Service & capacity management (package durations, crews, holidays) | `admin.html` → Services & capacity |
| Administration | Approval workflow (accept / reject / reassign, change requests) | `admin.html` → Reservations |
| Reporting | Dashboard & analytics (totals, peak times, cancellation rate) | `admin.html` → Dashboard |
| Notifications | Email on creation & status updates, reminder the day before (8:00 AM Manila) | `src/mailer.js`, `server.js` |

**Emails:** with no SMTP settings in `.env`, emails are printed in the VS Code terminal. Add `SMTP_*` values to send real ones.

## Email & notifications

**In the site (always on):** a bell in the header shows notifications. Clients get one when they book, when staff approve/reject, and for cancel/reschedule requests. Staff and admins get one for every new booking and every cancel/reschedule request.

**By email (needs setup):** the same events are emailed. New accounts must also confirm their email before booking, but only when email sending is set up. With no email settings, emails print in the terminal and nobody is blocked.

### Works on Render's free plan: Brevo (free, 300 emails/day)
Render's free plan blocks normal SMTP, so use Brevo's web API instead.
1. Create a free account at brevo.com.
2. Go to **Senders, Domains & Dedicated IPs → Senders**, add the email you want emails to come from (a Gmail works) and click the link Brevo emails you to verify it.
3. Go to **SMTP & API → API keys** and create a key.
4. Add these settings (in `.env` locally, or in **Environment** on Render):

| Key | Value |
|---|---|
| `BREVO_API_KEY` | the key from step 3 |
| `MAIL_FROM_EMAIL` | the sender you verified in step 2 |
| `MAIL_FROM_NAME` | MIB Photoman |
| `APP_URL` | your site address, e.g. `https://mib-booking.onrender.com` |
| `STAFF_NOTIFY_EMAIL` | optional: where staff alerts are emailed (comma separated) |

## Forgot password

On the login page, **Forgot your password?** emails a link (valid 1 hour) to `reset.html`, where the client picks a new password. The reply never says whether an email is registered. Without email set up, the link is printed in the terminal.

## Reservation fee (down payment)

1. When a client books, the fee is calculated as a percentage of the total (default **30%**, change it in **Admin → Services & capacity → Booking & payment settings**, along with your GCash / bank instructions).
2. Right after submitting, the client sees the instructions, pays, then enters the payment method, amount and **reference number** (a screenshot is optional). The booking shows **Verifying**.
3. Staff open **Admin → Reservations → Payment column** and choose **Verify deposit**, **Reject** (client is told to resend), **Record deposit** (for money received in person) or **Mark fully paid**. Approving a booking before the fee is verified asks for confirmation.
4. The client is notified at each step, and the dashboard shows **Payments collected**.

Payment statuses: Unpaid → Verifying → Deposit paid → Paid. Payments are checked by your staff against your GCash / bank records; the site does not move money itself.

## Updating an existing install

1. Copy this folder's contents over your existing project folder (replace files; keep your `.env` and `node_modules`).
2. Run `npm run db:init` once. It safely upgrades your database (adds start time, print layout, notifications and email confirmation) and keeps your data.
3. Restart with `npm run dev`. For the online version, also run `npm run db:init` once with your Supabase `.env`, then `git add .`, `git commit`, `git push`.

## Notes

- **Booking time is fully adjustable:** customers pick any start time they like. An event lasts as long as its package hours, and a booking is refused only if it overlaps as many events as you have crews (set in the admin page).
- **Layout examples:** the five sample prints shown in the booking form are in `public/img/layouts/` (a full-size and a `-thumb` file each). Replace a file, keeping its name, to change an example.
- **Print layouts:** 4R Portrait, 4R Landscape, 4R Double Landscape, 4R Polaroid Portrait, Filmstrip. Stored with each booking and shown to staff.
- Packages and add-ons are seeded from the MIB flyer. Edit package prices/durations in the admin page; add-ons can be edited in the `addons` table.
- "Per Table Prints" is priced at its starting ₱5,000 (flyer range ₱5,000–₱8,000); staff confirm the final amount.
- Extensions are charged as flat add-ons; Unlimited Magnet and 5R Size Upgrade are per hour.
- Slideshow photos live in `public/img/gallery/`. Swap the files (keep the names) to change them.

## Structure

```
server.js            Express app + reminder job
db/schema.sql        PostgreSQL tables (and upgrade steps)
src/initDb.js        creates tables + seeds packages, add-ons, settings, demo users
src/routes/          auth, public, bookings, admin APIs
src/lib.js           availability / double-booking check, email helper
public/              HTML pages, css/styles.css, js/ (vanilla JS), img/ (logo + photos)
```
