# Trip Log (development draft v0.6)

Drivers press **Accept** when the trip starts and **Finish** when it is done (Pickup Done is optional).
The server records each time, and that record carries one trip (Accept -> Finish) through hours, per-trip pay,
approval and payout. Accept opens 15 minutes before the planned start (changeable in Settings), so a trip
cannot be accepted the day before. Finished trips leave My Trips and stay in Trip History.

- Works in any phone or PC browser; can be **installed on the phone home screen** like an app (free, no app store)
- Office staff start on **Today**: only the things that need them now (long trips, trips not accepted, corrections, pay to approve)
- **Notifications** (bell + free phone alerts): driver on a new trip, approvers on a correction, admin/scheduler when a trip passes 13 h
- Accept and Finish can be **undone for 10 seconds** after a mistaken tap
- One-page **Quick guide** per role (the ? button at the top)
- Each role sees only the pages it needs, and **the server checks permissions on every request**
- Trip events and the audit log can never be edited or deleted; corrections are added as new records
- Receiving records the fish species, lot numbers and the date and time each truck was received
- Zero-cost setup: one company NAS runs the app, PostgreSQL and automatic backups

## Pages by role

| Role | Pages |
|---|---|
| Driver | My Trips (Accept, Pickup, Finish, fix a time), Trip History (own), My Pay (own) |
| Scheduler | Assign trips, Saved addresses, Live trips, Time corrections (approve step 1), Trip History |
| Logistics Manager | Receiving (record fish, lot no., weight in lb, Case/Tote count, received time; **Find received fish** by lot, fish or date), Trip History |
| Payroll | Time corrections (final approval), **Pay** (To approve / Approved · unpaid / Paid), **Drivers pay setting** (each driver's pay options + company Pay rules), Pay History (Excel) |
| Accounting | Pay drivers (To pay / Paid tabs: mark paid, CSV), Pay History (read-only per driver and trip, Excel), Activity log |
| Admin | Everything, plus Settings and Users |

**Trip History lot numbers (v0.7.4).** Office roles see a Lot no. column next to Route (first lot, "+N" for more, fish underneath, "–" if not received yet) and can find a trip by lot number or fish. The page now scrolls the table inside its card, so Status is never cut off.

**Status tabs (v0.7.3).** Receiving, Assign trips, Live trips, Pay and Pay drivers are split into tabs with counts. The first tab is what that role must act on: Receiving = Ready to receive / On the road (view only) / Received; Assign trips and Live trips = Not accepted / On the road / Finished; Pay = To approve / Approved · unpaid / Paid; Pay drivers = To pay / Paid. A truck can only be received after the driver taps Finish (the server refuses earlier).
 
The single source for this table is `ROLE_PERMS` in `shared/logic.js`; the server and the UI both use it. 

## Pay rules (Payroll changes them on the Drivers pay setting page)

**Default values follow BC employment standards (2026). Payroll can change every value at any time** (Drivers pay setting → Pay rules,
with a "Reset to BC defaults" button). Changes apply to pay not yet approved; approved pay never changes.

- Recorded time = Accept button to Finish button
- Paid time = recorded time minus the meal break (30 min) **only on trips over 5 h**, then rounding (default: no rounding).
  No deduction when the driver had to stay on call during the break (per driver, or tick it per trip when approving)
- **Minimum daily pay**: at least 2 h a day, or 4 h when the day was scheduled for more than 8 h (top-up at the regular rate)
- **Stat holidays** (BC list built in, plus extra company holidays): worked = 1.5×, 2× after 12 h that day (no overtime on top).
  Not worked = average day's pay (wages in the 30 days before ÷ days worked), shown on Pay to approve. Eligibility (15 of the
  30 days before) is checked and flagged
- **Minimum wage** (CAD 18.25/h): a rate below it is flagged and pay cannot be approved
- **Overtime**, per driver (default None): short haul 1.5× after 9 h a day and 45 h a week (only the first 9 h of each day count
  toward the 45); long haul 1.5× after 60 h a week
- **Vacation pay**, per driver: None / 4% / 6% (BC: 4%, 6% after 5 years). Added to each pay line
- **Deductions**: tax, CPP and EI are done by your payroll provider or accounting. Optional % lines in Pay rules only show an
  estimated net on Payouts
- No night or weekend premiums. A trip counts on the day it was accepted (Pacific time); weeks run Monday to Sunday.

Automatic checks on each pay line: below minimum wage, no rate, minimum pay applied, stat holiday (and eligibility), break paid,
long trip, Finish/receiving mismatch, open correction.

**These rules are a guide. Confirm them with your payroll provider.** Sources:
[BC Employment Standards Regulation s.37.3 (truck drivers)](https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esr-part-7-section-37-3),
[BC statutory holidays](https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays),
[BC minimum wage](https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/wages/minimum-wage).
- Long trip warning: over 13 hours (based on Canadian hours-of-service; confirm against current rules)
- Flags a trip when Finish and Receiving times differ by more than 30 minutes
- Changing paid minutes at approval requires a reason. Approved trips are locked and cannot be corrected

## Team trips and vehicle types (v0.8.0)
- **Team trip**: in Assign trips pick a second driver. Each driver gets their own trip record (the second one ends in `-B`), shown with a **Team** badge and the teammate's name. Each driver presses Accept and Finish for themselves.
- **Pay rule (to confirm with staff)**: each team member is paid for their **own** Accept-to-Finish time. Nothing is split or halved. Pay is approved per driver, so nobody is paid twice. The rule lives in `approveTrip` (`src/routes.js`), which prices one trip record at a time; to change it, change that function.
- Logistics views (Receiving, Live trips, Trip History for office staff, received-fish search) count a team trip once. Receiving is saved once for the whole team and needs both drivers to have finished. Pay History weight is counted once; Pay History and Payouts list one line per driver.
- A team trip can be cancelled only while neither driver has accepted.
- **Vehicle type**: a plain list (10 ton truck, 5 ton truck to start). Scheduler/Admin press **Add** next to Vehicle type in Assign trips to add more.
- **Finish before pay**: Payroll cannot approve, and Accounting cannot mark paid, a trip until the driver pressed Finish ("Driver has not finished this trip yet"). Unfinished trips show under a warning on the Pay page.
- Jaskaran's demo account has both Logistics Manager and Scheduler roles (an admin can give any person several roles on Users & roles). Sign-in buttons read "Role - Name".

## One trip at a time (v0.8.1)
- A driver can only drive one trip at a time. In **Assign trips**, if the driver (or the second driver of a team trip) is on the road now, or already has an assigned trip whose time overlaps the new one (booked by any scheduler), the app asks **"This driver is currently on a trip. Create anyway?"** with **Cancel** and **Create anyway**. The server refuses such a trip (409) unless the request carries `confirm: true`; Create anyway is noted in the audit log.
- Overlap uses Planned start + Estimated hours. A trip with no estimate counts as **8 hours**. Estimated hours is an optional field in Assign trips.
- **My Trips** shows a **Current trip** card (the running trip, or the earliest one not accepted yet) and an **Upcoming** list. Upcoming trips are view-only ("Finish your current trip first"). The server also refuses Accept on a later trip while an earlier one is unfinished.

## Early start (v0.8.2)
- Drivers can press Accept a few minutes before the planned start (Settings, "Accept opens before planned start", 15 min by default). Assign trips shows this under Planned start.
- Before that, the driver's Current trip card says "You can accept 15 minutes before the start time. To leave early, ask your manager." with an **Early start** button (optional reason). One open request per trip.
- Schedulers and Admins see **Early start requests** at the top of Assign trips (and on Today) and press **Approve** or **Decline** (optional reason). Approve lets the driver accept right away; the driver is notified either way and can ask again after a decline. Requests and decisions are in the audit log.

## Accounts and sign-in

- **Demo mode** (`npm run demo`, start.bat): demo accounts and sample data, demo buttons on the sign-in page, a "Demo" badge on screen.
- **Real mode** (`npm start`, Docker on the NAS): no demo anything. First start asks for the admin account.
- "Keep me signed in on this device" (ticked by default): stays signed in for 30 days (signed out after 14 days unused).
  Untick it on shared computers. Without it: office 30 minutes idle, drivers 16 hours.
- Temporary passwords from the admin must be replaced at first sign-in. Changing your password signs out your other devices.

## Windows: double-click to run

No command window needed:

- **start.bat**: installs what is needed on the first run, starts the app and opens http://localhost:3000
- **stop.bat**: stops the app
- **start-shared.bat**: same, but other PCs on the office network can open it too and share the data (see below)
- **reset-demo.bat**: deletes the local test data and starts again with fresh sample data
- **Reset demo data button** (Admin → Settings): does the same from inside the app, without closing it. See "Demo reset" below

Run start.bat again after updating the app files, so the new version is used.

### Test together with shared data (one PC hosts)

start.bat keeps the app private to one PC, so each PC has its own separate data. To let coworkers test with the **same data**:

1. On **one** office PC (the host), double-click **start-shared.bat**. The first time, Windows asks for permission to open port 3000 to the office network: click **Yes**. If Windows asks whether to allow Node.js on networks, click **Allow**.
2. The window shows an address like `http://192.168.1.25:3000`. Give it to coworkers.
3. Coworkers type that address in their browser (same office network, or on Tailscale using the `100.x` address). Nothing to install on their PCs.

Good to know:
- All test data lives on the host PC (`data/` folder). Keep that PC on and awake while others test.
- Plain http, demo accounts with a known password: for testing only, not for real pay data. The real app runs on the NAS (below).
- The firewall rule only allows the local network and Tailscale (`100.64.0.0/10`). To remove it: in an admin Command Prompt, `netsh advfirewall firewall delete rule name=TripLogTest3000`.
- Stop sharing with stop.bat. Running start.bat on the host makes it private again (same data).
- Phone alerts and "install app" need https, so they don't work in this mode. Everything else does.

## Try it locally

Needs Node.js 20+ (Windows, Mac or Linux). No separate database install: without `DATABASE_URL` the app uses embedded PostgreSQL (PGlite).

```bash
npm install
npm run demo          # open http://localhost:3000  (shows demo-account buttons)
npm run reset-demo    # delete the local database and start over
```

**Demo reset.** The sample data shows the whole flow: trips assigned by Dispatch, on the road, finished, received by Logistics (fish, lot, weight in lb), pay approved by Payroll, and paid payments per driver for Accounting. Between demos, an admin opens Settings → Demo data → **Reset demo data**, confirms, and everything entered during the demo is replaced by this sample data (everyone is signed out). The button exists only in the local demo (`DEMO_LOGIN=true` on the embedded database). It is never shown and the server refuses it on the NAS (PostgreSQL via `DATABASE_URL`), so it cannot wipe real data.

**Where is the database?** In the app folder: `data/pglite/`. It is created automatically on the first `npm run demo`, filled with demo accounts and sample trips, and kept between runs. Stop the app with Ctrl+C.

Run the security and flow checks against a running demo app (`npm run demo`, in a second terminal):
```bash
# Mac/Linux
BASE=http://127.0.0.1:3000 npm test
# Windows PowerShell
$env:BASE="http://127.0.0.1:3000"; npm test
```

Demo accounts: `admin`, `driver1`-`driver4` (Driver 1-4), `scheduler` (Kaitlin), `logistics` (Jaskaran: Logistics Manager + Scheduler), `payer` (Simon), `accounting` (Rene) / password `demo1234!!`. Admin can rename anyone on the Users page.

## Deploy on the company NAS (zero cost)

You need: a NAS that runs Docker (Synology Container Manager, QNAP, etc.) and a free Tailscale account.

1. Create two shared folders on the NAS:
   - `trucking-app` : the code (pulled from GitHub)
   - `trucking-backup` : where backups are written. Create a **read-only NAS account** for manager PCs that can read only this folder.
2. SSH into the NAS:
   ```bash
   cd /volume1/trucking-app
   git clone https://github.com/<company>/<repo>.git .
   cp .env.example .env        # fill in POSTGRES_PASSWORD etc.
   docker compose up -d --build
   ```
3. Open the app. A real install starts **empty** (no demo accounts, no demo data) and shows **First start**:
   create the admin account there. Then add each staff member on the Users page with a temporary password;
   they must choose their own password at their first sign-in. Forgot a password? Admin → Users → Reset password.
   (Alternative from the NAS shell: `docker compose exec app node src/admin-create.js boss "Owner Name"`.)
4. **Outside access (free HTTPS)**: install the Tailscale app on the NAS, sign in, then:
   ```bash
   tailscale funnel --bg 3000
   ```
   This gives an address like `https://<nas-name>.<tailnet>.ts.net`. Drivers install it on their phone home screen
   (Android: menu → Install app; iPhone: Share → Add to Home Screen). Install and phone alerts need this https address.
   Optional: set `PUSH_CONTACT=mailto:you@company.com` in `.env` (contact address sent with phone alerts).
   The DB port is never exposed, the app port is bound to the NAS itself (127.0.0.1), and no router port forwarding is needed.
   - If you later want your own domain (about $10-20/year), you can switch to Cloudflare Tunnel.

### Updating

After new code is pushed to GitHub, on the NAS:
```bash
cd /volume1/trucking-app && git pull && docker compose up -d --build
```

## Backups (fully automatic)

### Step 1: daily backup on the NAS
`docker compose up` also starts the `backup` container, which dumps the whole DB **every day at 02:00** into `trucking-backup`.
- Files: `trucking-20261121-0200.dump` + checksum `.sha256`
- Each file is checked right after it is written to confirm it can be restored
- Backups older than 30 days are deleted automatically (`BACKUP_KEEP_DAYS` in `.env`)
- Take one right now: `docker compose run --rm -e BACKUP_NOW=true backup` (stop with Ctrl+C)

### Step 2: automatic copy to manager PCs (no window)
So records survive even if the NAS fails, manager PCs pull the backups **on their own**.

1. Copy the `backup/windows` folder to the manager's PC
2. Double-click `install-backup.bat` **once** and enter the NAS path (`\\NAS\trucking-backup`) and the read-only account
3. That's it. From then on it:
   - runs every day at 09:30 and at each Windows sign-in, **with no window**
   - runs as soon as the PC is back on if a run was missed
   - copies only new backups and verifies each checksum
   - removes copies older than 60 days (always keeps the 7 most recent)
   - writes one line per run to `Documents\Trip Log Backups\backup-log.txt`, with a warning if nothing new arrived for 3 days
4. To remove: `uninstall-backup.bat`

Installing on two or more PCs gives you several copies. Backups contain personal data (names, pay), so turn on BitLocker on those PCs.

### Restore
On the NAS:
```bash
cd /volume1/trucking-app
sh backup/restore.sh /volume1/trucking-backup/trucking-20261121-0200.dump
```
It saves the current state as `before-restore-*.dump` first, then rolls back.
If the whole NAS dies: start the app on a new NAS (or any PC) with step 2 above, then run the same command with the latest `.dump` from a manager PC.
**Practice a restore once a quarter** (restore into a test folder).

## Security summary

| Area | Implementation |
|---|---|
| Transport | HTTPS only (Tailscale Funnel handles certificates). Security headers (CSP, HSTS, clickjacking protection) |
| Passwords | Stored only as bcrypt(12) hashes. 5 failures lock the account for 15 minutes; per-IP attempt limit |
| Sessions | Random token, only its hash is stored. HttpOnly, Secure, SameSite=Strict cookie. Idle sign-out: 30 min office roles / 16 h drivers |
| CSRF | Per-session token checked on every change |
| Authorization | Every API call checks role and data ownership. Another driver's trip number returns 404 |
| Separation of duties | Requester ≠ approver, step-1 approver ≠ final approver |
| Input | All values validated server-side; every SQL statement uses bound parameters; UI renders with textContent only (XSS) |
| Record protection | DB triggers block updates/deletes on trip events, notes and audit log. Approved pay amounts cannot change |
| Time | Button times come from the server clock only (phone clock changes have no effect) |
| Errors | Users see a generic message; details go to the server log only |
| CSV | Blocks Excel formula injection (=, +, -, @) |
| Accounts | Deactivating, changing roles or resetting a password signs that person out immediately |

## Not done yet (next steps)

- Two-factor sign-in (OTP) for Admin, Payroll and Accounting (in the requirements; planned for the next version)
- Waybill and receiving photo uploads (private storage, visible only to permitted roles)
- Pay-period close/lock, and "adjustment on next pay run" for errors found after approval
- The Docker setup and the Windows backup scripts are written but have not yet been run on a real NAS / Windows PC

## Folder layout

```
src/            server (Express): server.js, routes.js (API + permissions), auth.js (sign-in, sessions, CSRF), db.js, schema.sql, seed.js, admin-create.js
shared/logic.js role table, time and pay math (shared by server and UI)
public/         UI (index.html, app.js, style.css), sw.js + manifest.webmanifest + icons/ (install on phone, alerts)
src/notify.js   notifications, free Web Push, 13-hour watcher
test/smoke.js   83 security and flow checks
docker-compose.yml, Dockerfile, .env.example   NAS deployment
backup/         nas-backup.sh (daily), restore.sh, windows/ (manager PC auto-copy)
preview/        builds the no-server clickable preview
```

## Receiving: Case / Tote count

Enter the total weight in lb, then pick **Case** or **Tote**. The count fills in as weight ÷ average weight per unit, rounded to the nearest whole number. The receiver can change it by hand. A small note under the count shows how it was worked out.

| Unit | Average weight |
|---|---|
| Case (fresh) | 49.5 lb |
| Tote (full) | 975 lb |

To change an average, edit `PACK_UNITS` at the top of `shared/logic.js` (one place; the screen, the note and the server all use it), then restart the app. Tonnes are still saved for each line (from the lb weight) so Pay History and the Excel export keep working.

