# PitStock — Garage Inventory Management (PRD)

## Original Problem
"I own a car garage and I want to manage my inventory in terms of both incoming and outgoing stock, know the cost and selling price of each item, create barcodes for the items, track material balances, determine repurchase points, and manage all other inventory-related data."

## User Choices
- Auth: JWT (owner + staff)
- Barcodes: Auto-generated Code128 + webcam scanner + manual entry
- Currency: EUR (€)
- Languages: English (default), Nederlands, العربية with full RTL layout
- Design: dark industrial "Performance Pro" theme

## Architecture
- Backend: FastAPI + Motor + MongoDB, JWT (PyJWT), bcrypt
- Frontend: React + React Router 7 + TanStack Query + Tailwind + Shadcn UI + recharts + react-barcode + html5-qrcode + jsPDF + html2canvas
- Fonts: Chivo (display) + IBM Plex Sans (body) + IBM Plex Mono (data) + Cairo/Amiri (Arabic)

## Implemented
### Iteration 1 (MVP)
- JWT auth, seeded admin (admin@garage.com / admin123)
- Inventory CRUD + auto-SKU + auto-barcode + printable Code128 labels
- Stock IN/OUT with supplier/customer, stock validation, cost auto-update on IN
- Webcam barcode scanner + manual lookup
- Suppliers & Customers directories
- Transactions ledger
- Dashboard: KPIs, 14d movement line chart, top movers, low-stock action panel
- Basic reports: 30d movement + value-by-category donut

### Iteration 2
- CSV Import with downloadable template
- Receipt Printing with garage settings page
- Vehicle search filter
- Staff Accounts with owner-only role guards + OwnerRoute

### Iteration 3
- Purchase Orders (draft → sent → received; auto-suggestion from low-stock; IN txn on receive)
- Customer Invoices bundling OUT transactions; per-customer running balance
- Barcode Batch Print (multi-select on inventory + label grid)
- Profit Report with date range presets (7d/30d/90d/YTD), revenue/cost/profit/margin, by category + by part

### Iteration 4
- Repair / Job Cards: one card per car with customer + vehicle + mechanic + complaint / diagnosis / work done + parts_used with auto stock deduction + labor + grand total
- Card completion → Invoice generation

### Iteration 5 — PDF reports & Arabic
- **PDF export** for job cards, inventory, customers, suppliers, and repair list — via jsPDF + html2canvas (Arabic-safe via HTML snapshot)
- **Print** button on every list & card (physical printer OR native Save-as-PDF)
- **Full Arabic i18n** with RTL layout (Cairo/Amiri fonts), plus Dutch. Language switcher in header.

### Iteration 6 — Cash Register, Reminders, Scan Pickup
- **Cash Register** daily till (paid invoices, tax, in/out flow, by-customer split, PDF/print)
- **Service Reminders** with Resend-managed email + `.emergent/crons.yml` daily sweep
- **Scan Pickup** — warehouse-to-jobcard barcode allocation flow
- SHAWISH branded logo (`/logo-shawish.png`) in header + job card PDFs; **replaced 2026-02 with cleaner watermark-free variant** (`nrg6whzv_image.png`, ~40 KB)

### Iteration 7 — Payment Methods & Account Balances (Feb 2026)
- **Dynamic payment methods**: seed defaults Cash / Bank Transfer / Card-ATM; owner can add/edit/deactivate/delete (delete blocked while entries exist). Types: cash / bank / card / other.
- **Opening balance** per method + full ledger (`payment_entries`) with running balance.
- **Manual entries**: deposits & withdrawals with counterpart + note; only manual/opening entries are user-deletable (ledger immutability for invoice/PO/repair-linked entries).
- **Invoice mark-paid dialog** picks a payment method → auto-logs an IN entry equal to invoice total.
- **PO receive dialog** picks a payment method → auto-logs an OUT entry equal to PO total (payment_method fields serialized on the model). Method existence validated up-front to avoid partial receive.
- **Accounts page** (`/accounts`): method cards with balances, grand total card, statement per method with date range + summary boxes (period opening / total in / total out / closing) + PDF/print export.
- **Cash Register** now shows a "By payment method" breakdown and a payment-method column (incl. in PDF/print export).
- 12/12 pytest cases in `/app/backend/tests/test_iteration5.py` green.

### Iteration 8 — Labor Time Clock (Feb 2026)
- **Settings.labor_rate** (€ / hour) editable from Owner → Settings.
- **RepairCard.time_logs**: array of `{mechanic_id, mechanic_name, started_at, stopped_at, minutes, note}`; `labor_minutes` totals completed sessions.
- Endpoints: `POST /api/repairs/{rid}/clock-in`, `POST /api/repairs/{rid}/clock-out`, `POST /api/repairs/{rid}/time-logs` (manual), `DELETE /api/repairs/{rid}/time-logs/{log_id}`.
- On clock-out/manual add/delete: `labor_charge = round(total_minutes/60 × labor_rate, 2)` and `grand_total = parts_total + labor_charge` — persisted + recomputed. Manual override via PUT still allowed (next clock-out will re-sync).
- Guards: 400 when clocking in while another log is running; 400 when clocking out with no running log; 400 on stopped_at <= started_at for manual entries.
- **UI**: `TimeClockPanel` inside the repair card editor with live HH:MM:SS timer, mechanic + start-time display, Clock in/out button, per-log rows (mechanic, start→stop, minutes, €, note, remove), summary tiles (Duration / Rate / Auto-labor). Status auto-flips from `open` → `in_progress` on first clock-in.
- **PDF**: exported job card now includes a "Labor time clock" table with all logs and total duration (i18n-aware).
- 81/81 backend pytest cases green (`/app/backend/tests/test_iteration6.py`).

## Admin Seed
- **Owner**: admin@garage.com / admin123
- **Staff**: mike@garage.com / mike1234

### Iteration 11 — Dashboard v2 + Photos + BTW + ZIP + Cash Movements + Excel (Feb 2026)
- **Dashboard v2**: open-cars grid (photo/plate/customer/hours-in-shop/grand-total), revenue today / week / month KPIs, mechanic-hours-today panel, cars-in-workshop count.
- **Vehicle photos on repair cards**: `POST/GET/DELETE /api/repairs/{rid}/photos` + `GET /api/photos/{id}?auth=<token>` (query-string auth so `<img src>` works) — Emergent Object Storage backed, 10 photos × 5 MB cap, kind = before/after/damage/general. New `RepairPhotos` component in the editor with grid + preview modal.
- **BTW / VAT breakdown**: `RepairCard.tax_rate/tax_amount/total_with_tax` + `_recalc_repair` recomputes on every save. `_recalc_fields()` helper ensures all 5 computed fields (`parts_total/labor_minutes/grand_total/tax_amount/total_with_tax`) persist on every mutation (PUT, add-part, remove-part, clock-out, add/delete time log). `POST /api/repairs/{rid}/invoice` now defaults tax_rate to card.tax_rate then settings.default_tax_rate.
- **Bulk invoice ZIP** (`/app/frontend/src/lib/invoice-zip.js`): JSZip + file-saver, per-row checkboxes; "Download all · ZIP" or selected subset.
- **Manual cash movements**: `POST/GET/DELETE /api/cash-movements`; every entry mirrors into `payment_entries` so account balances stay in sync. `CashMovementsPanel` in the Cash Register page.
- **Excel exports** (`openpyxl`): `/api/reports/inventory/excel`, `/api/reports/invoices/excel`, `/api/reports/profit/excel` (2 sheets), `/api/reports/cash-register/excel` (2 sheets). Buttons wired in Reports / Invoices / Cash Register.
- **Users management**: already existed on Staff page — invite email/password/role.
- **Auth**: `get_current_user` now also accepts `?auth=<token>` query-string (needed by `<img>` tags).
- Verified end-to-end via curl: tax persistence (100 × 21% → 21 / 121), photo upload+download via query auth (200 with correct bytes), 401 without auth, invoice from repair inherits card tax_rate.

### Iteration 10 — Database Backup & Cloud Sync (Feb 2026)
- **`/app/backend/backup.py`** — self-contained backup module: `build_snapshot()` gzips 14 managed collections into a `version:1 / app:pitstock` JSON archive; `restore_snapshot()` wipes + inserts atomically; Emergent Object Storage helpers (`init_storage`, `_put_object`, `_get_object`) with dead-key retry.
- **Owner-only endpoints under `/api/backup/*`**: `GET /export` (streams `.json.gz`), `POST /import` (multipart, 200 MB guard), `POST /cloud/push`, `GET /cloud/list`, `GET /cloud/download/{id}`, `POST /cloud/restore/{id}`, `DELETE /cloud/{id}` (soft-delete since Object Storage has no delete API).
- **Nightly cron** `/api/cron/backup` (bearer = `WEBHOOK_CRON_SECRET`) added to `.emergent/crons.yml` at `30 2 * * *`; auto-prunes to last 30 backups.
- **Frontend `BackupPanel`** (`/app/frontend/src/components/BackupPanel.jsx`) mounted at bottom of `/settings`: manual download, restore-from-file (with destructive-restore warning that flags user-account replacement), push-to-cloud, per-row download / restore / delete for cloud backups, EN/NL/AR translations.
- **13/13** new pytest cases in `/app/backend/tests/test_backup.py` + full 26/26 regression suite green (iteration_9).

### Iteration 9 — System Dark/Light Theme (Feb 2026)
- **ThemeProvider + ThemeToggle**: cycle `system → light → dark → system`, persisted in `localStorage['garage_theme']`; live-reacts to `prefers-color-scheme` change when set to `system`; initial `resolved` derived from storage (no first-paint flash).
- **index.css** rewritten: `:root` = LIGHT tokens (paper background, ink foreground), `.dark` = DARK tokens (industrial workshop). All shadcn tokens (background/foreground/card/border/muted/primary/accent/destructive/ring) covered.
- **Full contrast sweep**: replaced every dark-mode-only literal (text-amber-400 / emerald-400 / rose-400 / blue-400 / fuchsia-400 / sky-400) across Dashboard, Repairs, Calendar, Invoices, Reminders, PartyPage, CashRegister, ScanPickup, Reports, Accounts, StockMovement, Staff, Inventory, PurchaseOrders, Transactions with `text-{color}-700 dark:text-{color}-400` pairs.
- **Dashboard recharts** switched to CSS variables (`hsl(var(--border))`, `hsl(var(--muted-foreground))`, `hsl(var(--card))`) so grid + axis + tooltip adapt to both themes.
- **Repairs job-card header band** switched from stark `bg-black/95` to `bg-secondary` (theme-aware) in both list card and dialog editor.
- Verified by testing_agent iteration_7 (toggle mechanism) + iteration_8 (WCAG contrast sweep in both modes).

### Iteration 14 (Feb 2026) — Data safety + editable directory
- **Locked identity fields on job cards**: customer name/phone + all vehicle inputs (make, model, year, plate, color, odometer) are now `readOnly` + disabled by default so a slip of the keyboard can't wipe them. A padlock toolbar at the top of the card shows the current state, holds an "Unlock" button (with a confirmation prompt), and re-locks after the owner is done.
- **Dynamic link to the customer record**: if a job card is linked to a customer (`customer_id`), the lock bar shows a chip with the linked customer's current name. When that record's name or phone diverges from what's saved on the card, an amber "Sync from customer record" button appears — one click pulls the freshest data into the card. Backend also auto-pushes name/phone updates to every **open (non-invoiced)** repair card of the same customer via `PUT /api/customers/{id}`.
- **Editable Customers & Suppliers**: added a pencil "Edit" button to each row that reuses the same dialog in edit mode. New backend endpoints `PUT /api/customers/{id}` and `PUT /api/suppliers/{id}` with partial-update semantics (404 when missing, 400 when empty body). Verified end-to-end with curl.
- **Fixed missing logo in job-card modal**: URLs that start with `/api/` are now prefixed with `REACT_APP_BACKEND_URL` and fall back to the bundled `/logo-shawish.png` on error.
- Full AR / NL / EN i18n for the new controls and confirmations.
- **Fixed logo missing on print/PDF**: `/api/settings/logo-file` is now PUBLIC (`<img>` tags cannot send Authorization headers). Frontend also inlines the logo as a base64 data URI via `logoAsDataUrl()` so it always renders inside html2canvas snapshots.
- **Fixed PDF-download page-shrink bug**: rewrote `pdf.js` to render inside a hidden same-origin iframe instead of appending to `document.body`. Parent page's `scrollHeight` stays identical before / during / after export (verified 1068 → 1068).
- **Compact NL license plate**: dropped from 22 px / 6-18 padding to a proportional 12 px pill with a mini blue "NL" strip, matching the on-screen `PlateBadge`.
- **Bulk PDF ZIP**: `downloadInvoicesZip` now bundles one real `.pdf` per invoice (was `.html`) with a live "1/N..." progress label.
- **Send by email (new)**: `POST /api/invoices/{id}/email` + a per-row Mail button + dialog (recipient / subject / message). Updates `last_emailed_at` and `last_emailed_to` (fields added to the `Invoice` model so they surface on GET).
- **SEPA / iDEAL QR**: EPC069-12 payload built from `settings.iban + bic + name + inv.total + inv.invoice_number`, rendered as PNG inside a right-aligned "Payment details" block (with bank name, IBAN, BIC, reference). Toggleable via `invoice_show_qr`.
- **More customisation options** in `/settings`: `bank_name`, `bic`, `invoice_header_align` (Left / Center / Right), `invoice_currency_symbol_pos` (Suffix / Prefix — now actually applied by the invoice renderer), plus the SEPA-QR toggle.
- **i18n**: /invoices fully translated to Arabic (RTL), Dutch, English — headers, action tooltips, status pills, customer-balance card, ZIP button label, email dialog. RTL number placement in "N invoices · X outstanding" fixed with `dir=ltr` isolation.
- **A11y**: `DialogDescription` added to the email dialog to clear the Radix warning.
- Verified end-to-end by testing_agent (iteration_11) + self-verification: backend 14/14, frontend all critical scenarios green.

### Iteration 14 (Feb 2026) — Data safety + editable directory
- **Appointment Conflict Guard** (Calendar):
  - New `GET /api/appointments/conflicts?mechanic_id&start&duration_min&exclude` endpoint
  - New-appointment dialog now debounces a conflict check on every mechanic / date-time / duration change
  - Amber warning banner lists overlapping appointments; save still allowed with a confirm prompt
  - Non-blocking by design — owner can override for emergencies
- **Auto Reminder Cadence** (Invoices):
  - Invoice model gains `reminder_stage` (0-3) and `reminder_history[]`
  - New helper `_overdue_stage_for(days, current_stage)` decides the next escalation step
  - 3 tones with escalating language + color accent:
    - Day 1 → **Friendly reminder** (sky blue)
    - Day 7 → **Second notice · firm** (amber)
    - Day 14 → **Final notice** (rose)
  - `POST /cron/overdue-invoices` and `POST /invoices/overdue/send-reminders` both drive off the new stage helper
  - Invoices table shows a colored "Notice 1 / 2 / 3" pill under the Overdue badge with a tooltip of the last-sent timestamp
  - 10 stage-picker unit cases pass; conflict endpoint verified via curl (overlap=1, no-overlap=0, exclude-self=0)
- New `/workboard` page: week view (Mon–Sun) × mechanics grid with a right-side "Unassigned tasks" column
- Native HTML5 drag & drop: pull a card from the pool onto any mechanic × day cell (auto-defaults to 1h if no estimate set)
- Estimated hours picker on every card: 1h / 2h / 4h / 8h presets + custom input
- Per-day load bar (0–100 %+, colored green/amber/rose) shows if a mechanic is empty, healthy, or overbooked
- Per-mechanic weekly load bar (0–40 h) with availability dot (green/amber/rose)
- Conflict guard: prompts before letting a mechanic exceed 8 h in a single day
- Priority cycling (normal → high → low) with a red ring + flame icon for "high"
- Sidebar search across card #, customer, plate, make, model
- Status filter tabs: Active (default) / Open / In progress / All
- Week navigation (prev / today / next), RTL-aware chevrons
- Presenter mode toggle: compacts chips + auto-refreshes every 30 s for TV/big-screen display
- Full AR / NL / EN translations
- Backend additions: `RepairCard.estimated_hours`, `.scheduled_date`, `.priority`;
  new endpoint `POST /api/repairs/{id}/assign` (idempotent, patch-style)

## Iteration 14 (Feb 2026) — Special-parts bug fix + Delivery scan + CSV Fleet Import + Bay Board
- 🐛 **Bug fixed**: Special-order parts (added via SpecialPartsPanel) were **missing from the printed/PDF/WhatsApp** job card because `printJobCard()` in `Repairs.jsx` and `buildRepairCardHtml()` in `lib/reports.js` only iterated `card.parts_used`. Both now merge `parts_used + special_parts` and tag special ones with a **SPECIAL** pill. WhatsApp share message also lists them.
- 📦 **Delivery-note scan** (`/delivery-scan`): mechanic aims camera at supplier's packing slip → backend `_PLATE_RE` extracts the plate → auto-matches open card if a plate is found, otherwise shows a picker of open cards. New `POST /api/special-parts/scan-delivery` and a new frontend page. Add-part status defaults to `arrived` since the parcel is physically in the shop.
- 📊 **Live Bay Board** (`/bay-board`): TV-friendly grid of every open/in-progress card with time-in-shop, live clock counter, priority flame, on-order badge, mechanic assignment, and full-screen toggle. Refreshes every 30 s.
- 📥 **CSV Fleet Import**: paste or upload a CSV of plates + APK dates → backend `POST /api/import/vehicles-csv` bulk-creates customers + vehicles, deduping by (name, phone). Downloadable template. New `CsvImportDialog` button on Customers page.

## Roadmap / Backlog
- SMS fallback via Twilio when a customer has no email — P1
- Ordered-parts dashboard (cross-workshop) — P3
- Refactor `server.py` (~3400 lines) into APIRouter modules per domain

## Iteration 13 (Feb 2026) — Loyalty rewards + Car Passport QR
### Loyalty rewards
- New settings block (`loyalty_enabled` / `loyalty_threshold` / `loyalty_discount_eur`), configurable in the Settings page.
- New endpoint `GET /api/customers/{cid}/loyalty` — returns paid-invoice count, redeemed rewards, pending rewards, and cycle progress.
- Auto-application: whenever an invoice is generated from a repair (`POST /api/repairs/{rid}/invoice`) or from transactions (`POST /api/invoices/from-transactions`), if the customer has pending rewards, a negative `LOYALTY` line item is prepended and `customers.loyalty_redeemed` is incremented atomically.
- New "Loyalty" card in the customer history dialog with progress bar (or emerald "reward ready" badge when a milestone has been crossed).

### Car Passport QR
- Every `Vehicle` now has a unique `passport_token` (auto-generated with `secrets.token_urlsafe(12)`, lazy-backfilled for legacy rows).
- Public, unauthenticated endpoint `GET /api/passport/{token}` returns vehicle info, APK status, oil-change status, service events + recent repairs + garage branding.
- New public frontend route `/passport/:token` — `CarPassport` page renders a customer-facing view with plate badge, APK/oil status pills, service-event timeline, and recent repairs.
- New `CarPassportQrDialog` (uses `qrcode` package) opened from every vehicle row in the customer history — Copy link / Rotate token / Print sheet.
- `POST /api/vehicles/{vid}/passport/rotate` — one-tap way to invalidate a leaked QR.

## Iteration 12 (Feb 2026) — Structured address + smart vehicle picker
- **Structured customer/supplier address** — postcode, house number, addition, street, city, country stored as separate fields (backwards-compatible with the old single-line `address`, which is now auto-composed from the parts).
- **PDOK Locatieserver postcode lookup** — free official Dutch government geocoder. Type postcode + house number, blur → street + city auto-fill (green check ✓). Backend proxy at `GET /api/lookup/postcode` (in-memory cache).
- **NHTSA vPIC vehicle catalog** — 195 car makes and ~40 models per make, cached. Backend proxies `GET /api/lookup/vehicle-makes` and `GET /api/lookup/vehicle-models?make=X`.
- **Reusable frontend building blocks**:
  - `AddressFields.jsx` — postcode → auto-fill NL address block with loader/check indicators
  - `VehicleMakeModelYear.jsx` — searchable Make → Model → Year with a "type manually" toggle per field so unknown vehicles are still allowed. Year list auto-extends every calendar year (1980 → currentYear + 1).
- **Consumers updated**: PartyPage (Customer + Supplier add/edit), NewJobCardDialog (quick new customer + new vehicle inside a job card), Calendar (quick add customer / quick add vehicle), inline "Add vehicle" inside customer history.

## Files of note
- `/app/backend/server.py`
- `/app/backend/tests/test_iteration5.py` (payment method regression)
- `/app/frontend/src/pages/Accounts.jsx` (new)
- `/app/frontend/src/i18n/index.jsx` (EN/NL/AR dictionaries)
- `/app/frontend/src/lib/pdf.js` (html2canvas + jsPDF)
- `/app/frontend/src/lib/reports.js` (list & repair-card report builders)
- `/app/frontend/src/lib/barcode-batch.js` (label grid)
- `/app/frontend/public/logo-shawish.png` (SHAWISH brand, 40 KB variant)
