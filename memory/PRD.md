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

## Roadmap / Backlog
- Time tracking for labor (mechanics clock in/out on repair cards) — P1
- SMS fallback via Twilio when a customer has no email — P2
- Photo attachments for cars (vehicle damage/status on repair card) — P2
- Loyalty credit for returning customers (€ off after N paid invoices) — P2
- Refactor `server.py` (~1550 lines) into APIRouter modules per domain
- Replace per-method balance N+1 with a single Mongo `$group` aggregation
- Void/reverse ledger entries for invoice/PO corrections (soft-delete)

## Files of note
- `/app/backend/server.py`
- `/app/backend/tests/test_iteration5.py` (payment method regression)
- `/app/frontend/src/pages/Accounts.jsx` (new)
- `/app/frontend/src/i18n/index.jsx` (EN/NL/AR dictionaries)
- `/app/frontend/src/lib/pdf.js` (html2canvas + jsPDF)
- `/app/frontend/src/lib/reports.js` (list & repair-card report builders)
- `/app/frontend/src/lib/barcode-batch.js` (label grid)
- `/app/frontend/public/logo-shawish.png` (SHAWISH brand, 40 KB variant)
