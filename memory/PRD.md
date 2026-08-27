# PitStock — Garage Inventory Management (PRD)

## Original Problem
"I own a car garage and I want to manage my inventory in terms of both incoming and outgoing stock, know the cost and selling price of each item, create barcodes for the items, track material balances, determine repurchase points, and manage all other inventory-related data."

## User Choices
- Auth: JWT (owner + staff)
- Barcodes: Auto-generated Code128 + webcam scanner + manual entry
- Currency: EUR (€)
- Languages: English (default), Nederlands, العربية with full RTL layout
- Design: dark industrial "Performance Pro" theme
- Preferred chat language: Arabic

## Architecture
- Backend: FastAPI + Motor + MongoDB, JWT (PyJWT), bcrypt
- Frontend: React + React Router 7 + TanStack Query + Tailwind + Shadcn UI + recharts + react-barcode + html5-qrcode + jsPDF + html2canvas + xlsx (SheetJS) + MediaDevices getUserMedia
- Fonts: Chivo (display) + IBM Plex Sans (body) + IBM Plex Mono (data) + Cairo/Amiri (Arabic)

## Implemented (latest first)

### Session 2026-02-26q — Inline vehicle silently dropped on new-customer save
- **Bug**: Adding a new customer with an inline vehicle in the "Add Klant" dialog appeared to succeed, but the vehicle never persisted — the "New job card" and "Klant bewerken" dialogs both showed **0 gekoppelde voertuigen**. Only after re-opening the customer and adding the vehicle again did it appear.
- **Root cause**: The inline vehicle form ships every numeric / date field as an empty string (`next_oil_change_km: ""`, `apk_expiry: ""`). Pydantic v2 rejected `""` for the `Optional[int]` field with a 422 `int_parsing` error. The frontend `POST /customers` succeeded but the follow-up `POST /customers/{id}/vehicles` failed — and its `catch` block was silently ignored (`/* silent — customer is saved even if vehicle fails */`).
- **Fix (backend)**: Added Pydantic `@field_validator("next_oil_change_km", mode="before")` + `@field_validator("apk_expiry", mode="before")` on `VehicleCreate` — blanks now normalise to `None` so half-filled inline drafts persist.
- **Fix (frontend)**: `PartyPage.jsx` now sanitises the payload client-side too (`Number(...)` / `|| null`) **and** surfaces a warning toast if the vehicle POST fails instead of swallowing. Same normalisation applied to the standalone "add vehicle" flow.
- **Verified via curl**: `POST /api/customers/{cid}/vehicles` with `next_oil_change_km:""` now returns HTTP 200 + row visible in the follow-up GET.


### Session 2026-02-26p — Staff invite email actually sends + never silent-fails
- **Bug**: When the owner added a new worker, the invite email never arrived, so the worker could not set a password. Two root causes:
  1. Frontend `Staff.jsx` marked the password field `required` on create, forcing a value → the "no-password ⇒ email invite" branch on the backend was never reached.
  2. When `_send_password_setup_email` did fire and Resend rejected the address (e.g. undeliverable), the exception was swallowed with a `logger.warning`, so the owner saw a green "Invited" toast even though no email left the building.
- **Backend `POST /api/users`**: no longer swallows email errors; response now includes `email_sent`, `email_error`, `setup_link` so the UI can react. Same shape added to `POST /api/users/{id}/send-setup-link`.
- **Frontend Staff form**: password field is now optional, with helper text "Laat leeg om een e-mail met een link te sturen…". On failure the toast is a warning and the setup link is auto-copied to the clipboard so the owner can hand it over via WhatsApp / QR.
- **Verified via curl**: `delivered@resend.dev` → `email_sent:true`; existing `password_pending` staff → resend endpoint returns `email_sent:true` + fresh 7-day token.


### Session 2026-02-26o — Hardened role-based permissions (frontend + backend)
- **Bug**: staff users assigned a limited scope (e.g. only `inventory.view`) still saw every sidebar section and could hit every API endpoint — the `hasPermission()` helper and `require_permission` factory existed but were never actually wired to endpoints or nav items.
- **Backend**: extended `PERMISSION_CATALOG` with 3 new sections (`accounts`, `reminders`, `delivery_scan`) totalling 5 new scopes.  Retro-fitted `Depends(require_permission("xxx.yyy"))` on ~60 endpoints in `server.py` (customers, suppliers, inventory, invoices, repairs, appointments, ledger, payment methods/entries, bay-board, delivery-scan, reports, catalog-parts).  Wired `require_permission` into `routes/reminders.py` and `require_owner` into `routes/email_logs.py`.  Gated `/vehicles/{id}/passport/{token,rotate}` behind `customers.view/edit`.  Fixed `has_permission()` to bypass BOTH `owner` AND `super_admin` (was owner-only, which regressed super-admin platform access).
- **Frontend**: `AuthContext` now exposes `pathForUser(user)` — the first section a user is allowed to see (falls back to `/my-profile`).  `Login.jsx` redirects to that path after login (warehouse-only staff lands on `/inventory`, not `/dashboard`).  New `<PermGate perm="...">` route wrapper (`/app/frontend/src/components/PermGate.jsx`) redirects to the first-allowed path when a user types a forbidden URL.  `DashboardLayout` sidebar filters `NAV` through `hasPermission(nav.perm)` so only permitted sections render.  Every destructive action button in `Inventory.jsx`, `PartyPage.jsx`, `Repairs.jsx`, `Invoices.jsx`, `Reminders.jsx` is gated behind its matching scope (e.g. `add-item-button` only shows for `inventory.edit`, `mark-paid` only shows for `invoices.mark_paid`).  `Inventory.jsx` now gates `useQuery(['sup'])` behind `suppliers.view` so warehouse-only staff no longer trigger console 403 noise.
- **Tests**: 57/57 pytest cases green (`test_iteration16_permissions.py`, `test_iteration17_permission_fixes.py`) — covers super_admin bypass, reminders gating, email-logs owner-only, passport gating, owner end-to-end regression flow, and the full warehouse-only 403 matrix.  Frontend smoke confirmed: sidebar shows only permitted tabs, forbidden URLs redirect back, no 401/403 leaks in the network tab.


### Session 2026-02-26n — Modern time-clock + manual entry + clearer vehicle picker
- **TimeClockPanel redesign** (`Repairs.jsx`): hero card now uses a dark gradient with a soft grid, a live pulsing dot, and a 5xl→6xl monospace timer in emerald when running / slate when idle.  Clock-in / Clock-out actions moved into the same hero card so the primary action is always one tap away.
- **Manual entry row**: brand-new dashed-border section under the timer with three inputs (`minutes`, optional `custom € amount`, add-button).  Posts to the existing `POST /repairs/{rid}/time-logs` endpoint (computes `started_at = now - N minutes`, `stopped_at = now`).  Any custom amount is appended to the note (`… · Custom amount: € 55.00`) so the owner can spot overrides in the audit trail.  9 new i18n keys in EN/NL/AR.
- **Job-card vehicle picker empty state** (`NewJobCardDialog.jsx`): the "no vehicles yet" text became a full amber card with a `<Car>` icon, a clear headline ("Nog geen voertuig gekoppeld") and a big amber CTA button that jumps straight into the add-vehicle form ("Voertuig toevoegen aan {customer}").  The existing pick-from-vehicles grid (top of the section) is unchanged — it appears whenever the customer already has one or more saved vehicles.


### Session 2026-02-26m — Show-password toggle + Forgot-password flow
- **Backend `POST /api/auth/forgot-password`** — public endpoint. Accepts `{email}`, mints a fresh `password_setup_token` (24h TTL) on the matching user, sends the existing Dutch "Stel je wachtwoord in" email via `_send_password_setup_email`. Always returns `{ok:true, sent:true}` whether the address exists or not to prevent account enumeration.
- **`Login.jsx`** — eye-icon toggle on the password field (`<Eye>/<EyeOff>`), "Forgot?" link next to the label that opens a dialog with an email input + "Send reset link" button, non-blocking toast confirms the request regardless of email validity.
- **`PasswordSetup.jsx`** — same eye toggle on both "Nieuw wachtwoord" and "Bevestig wachtwoord" so staff can double-check what they typed before submitting.
- **i18n** — 10 new keys (showPassword, hidePassword, forgotPassword, forgotDialogTitle, forgotDialogDesc, forgotSent, sendResetLink, cancel, secureNote, backToHome) in EN + NL + AR.
- **Verified via curl**: existing email → 200 + `email_logs` row `accepted` + user's `password_setup_token` populated with 24h expiry. Unknown email → same 200 response (anti-enumeration confirmed).



### Session 2026-02-26l — CRITICAL bugfix: purge wiped out super_admin (platform lockout)
- **Root cause**: super_admin `platform@pitstock.app` had `tenant_id` stamped on it (contamination from a past impersonation / profile-update path).  `delete_tenant(purge=true)` runs `users.delete_many({tenant_id: X})` and swept the super_admin away — next login returned "Invalid credentials" and the platform was locked out with no way to manage garages.
- **Fix (2 layers)**:
  1. `routes/tenants.py` — the purge loop now branches for `users` and adds `role: {"$ne": "super_admin"}` so no future tenant delete can ever touch a platform admin.
  2. `server.py` startup — self-heal `update_many({role: "super_admin", tenant_id: {$ne: null}}, {$set: {tenant_id: null}})` runs on every boot, so any past or future contamination is cleaned up before the next request lands.  Logs the count when it fires.
- **Preview DB immediate recovery**: one super_admin had `tenant_id` set — cleared it manually before restart, then confirmed the startup self-heal picked it up on subsequent boots.
- **Verified end-to-end (testing_agent, 10/10 pass)**: reproduced the contaminated state (manually stamped `tenant_id` on super_admin via pymongo), ran `DELETE /api/tenants/{id}?purge=true`, confirmed the super_admin survived, login still returns 200, `GET /api/tenants` still 200, purged tenant's owner user was deleted (regression clean), tenant absent from list, plus soft-delete regression + 404 unknown + 403 owner-role guard. Test file: `/app/backend/tests/test_iteration15.py`.
- **Follow-up hardening (optional, tracked)**: block super_admin from ever being written with a non-null tenant_id at the write-time boundary (POST /users, PUT /users, impersonation) so the startup self-heal becomes a safety net rather than the primary defence.



### Session 2026-02-26k — SaaS billing + Dutch default + landing/login redesign
- **`routes/saas_billing.py`** — new module.  Model + PDF (via reportlab) + endpoints: `GET /saas-invoices` (super_admin list), `POST /saas-invoices/generate/{tenant_id}` (manual), `POST /saas-invoices/{id}/mark-paid`, `GET /saas-invoices/{id}/pdf` (streams the cached PDF).  Prices: trial=€0, starter=€29, pro=€79 per month (edit `PLAN_PRICE_EUR` map).  Idempotent per (tenant_id, period_start).
- **`subscription_cron.py`** — reminder path now calls `_create_saas_invoice(...)` on the 7/3/1-day nudge, attaches the PDF to the outgoing email, flips the SaaS invoice's status to `sent`.  All email HTML translated to Dutch (`Betaalherinnering` / `Abonnement verlopen`).
- **`GarageSettings.default_language`** (`en`|`nl`|`ar`) added — defaults to `nl`.  Settings default form updated.  i18n loader defaults to `nl` when no explicit user preference exists so first-time visitors see Dutch immediately.
- **Login page** — complete redesign.  Removed the "DEMO admin@garage.com / admin123" hint card and the split-image layout.  New centred glass card on the dark GarageFix-branded gradient (matches Landing), with placeholder inputs, `<ShieldCheck>` footer note, and a "← Terug naar startpagina" link back to `/`.
- **Landing page** — fully translated (EN + NL + AR) via `useLang()`.  Added the `LanguageSwitcher` component next to the Sign-in pill so a visitor can flip locales instantly.  Hero, badge, subtitle and the three feature cards all pull from i18n keys.
- Verified end-to-end: `POST /saas-invoices/generate/{tid}` returned invoice `GF-2026-0001`, `GET /saas-invoices/{id}/pdf` streams a valid PDF (Content-Type `application/pdf`, non-empty body).  Landing page screenshot in `nl` shows "Elke auto, elk onderdeel, elke euro — bijgehouden" with a working "NL" locale pill + "Inloggen" button.



### Session 2026-02-26j — Full Dutch/Arabic invoice + receipt translation
- **`invoice-render.js`** — extracted all invoice labels into an `I18N` map (`en` / `nl` / `ar`) covering paid/invoice badge, "Bill to", table headers (Item/Qty/Unit/Total), Subtotal/Total row, bank block (Bank / IBAN / BIC / Reference / Amount + "Pay with iDEAL/SEPA" heading + "Scan met bank-app" hint), "Payment due within X days", walk-in fallback, footer thank-you note, and `Date.toLocaleDateString` locale. `renderInvoiceHtml(inv, settings, { lang })` now defaults to Dutch when no lang given — the majority audience.
- **`receipt.js`** — same treatment for the kassabon: RECEIPT badge, Date / Customer / Note / Part / Qty / Price / Total / Tax ID / thank-you.
- **`invoice-zip.js`** — added `lang` parameter forwarded to `renderInvoiceHtml` for bulk PDF export.
- **`Invoices.jsx`** — pulls `lang` from `useLang()` and passes it to every `renderInvoiceHtml` / `printInvoice` / `downloadInvoicesZip` call; hardcoded `window.confirm("Delete invoice?")`, "Preparing PDF...", "Pick at least one transaction", "Invoice X created" toast, "Paid" button, WhatsApp share header/note now use `t(...)` with EN/NL/AR translations.
- **`StockMovement.jsx`** + **`Transactions.jsx`** — pull `lang` from `useLang()` and pass into `printReceipt`.
- **i18n** — added 13 new keys (confirmSendReminders, invoiceCreated, print, invoiceEmailSubject, ourGarage, deleteInvoiceConfirm, deleted, pickAtLeastOneTxn, preparingPdf, invoice, paidStatusText, waPleaseSettle, markPaid) with proper Dutch and Arabic values.



### Session 2026-02-26i — Public landing page + rebrand to "GarageFix"
- **`Landing.jsx`** new public page at `/` — dark hero with grid + glow, brand mark ("GarageFix · Workshop OS"), gradient headline, three feature cards ("Live cash register", "Scan any pakbon", "Multi-tenant secure"), footer sign-in link. Login CTA is discreet: a small pill button top-right + a matching link in the footer, so future marketing sections (pricing, screenshots, testimonials) can drop in without redesigning.
- **Routing**: `/` now serves the public landing; the authenticated Dashboard moved to `/dashboard`. Unknown routes redirect to `/dashboard` (which itself redirects to `/` when not logged in). Sidebar Dashboard link + login redirect + OwnerRoute/SuperAdminRoute fallbacks all updated to `/dashboard`. Guest bounces from a protected route now go to `/` (landing), not the login screen — cleaner first impression.
- **Rebrand**: replaced "PitStock / Inventory OS" (sidebar + login card) and "Garage Ops Command Deck" (login hero) with "GarageFix / Workshop OS" across DashboardLayout, Login, i18n (EN + NL), and the new Landing page.



### Session 2026-02-26h — "Pay now" button in overdue reminders (SEPA/iDEAL QR page)
- **Invoice model** gains `pay_token` (persistent random URL slug). Lazily minted on the first overdue send so past invoices don't need a migration.
- **`GET /api/public/pay/{token}`** (no auth) — returns amount, garage bank details (IBAN, BIC, KvK, address, phone), reference (= invoice number), current status (paid/draft) and a ready-to-use EPC SEPA URI (`sepa://?iban=...&amount=...&reference=...`) that every EU banking app understands.
- **`_sepa_uri()`** helper generates the SEPA payment URI with URL-encoded params. Recipient, amount and reference pre-fill in ABN AMRO, ING, Rabobank, SNS, Bunq, Revolut, N26.
- **Overdue reminder email** now includes a big **"Pay € X.XX now"** CTA button (colour matches escalation tone: red for final notice) that opens `/pay/{token}` — the CTA appears only if `APP_PUBLIC_URL` is configured, otherwise the email falls back to the plain IBAN line.
- **`/pay/:token`** public page (`PayInvoice.jsx`) — no login. Renders a beautiful mobile-first payment card: amount, SEPA QR (via `qrcode` npm lib), "Open my banking app" deep link, plus a "transfer manually" panel with click-to-copy IBAN / BIC / reference. Shows an emerald "Already paid" banner if the invoice status is `paid`. Rose error state on invalid/expired token.
- Verified: `GET /api/public/pay/{token}` returns correct JSON with `sepa_uri`, invalid token → 404, page renders QR + amount + copy buttons in a mobile viewport screenshot.



### Session 2026-02-26g — Bugfix: RDW model dropped from job-card form
- **Root cause**: `VehicleMakeModelYear.jsx` had auto-flip-to-manual for Make but NOT for Model. RDW returns detailed model strings like `"Civic 4Dr Hybrid"` while the catalog only lists `"Civic"`, so `SearchableSelect` silently rendered "Pick a model…" and dropped the value.
- **Fix**: mirrored the Make behaviour — once the models query resolves, if `v.model` isn't in the fetched list, flip `manualModel=true` so a plain `<Input>` shows the actual RDW string. Zero data loss regardless of how detailed the RDW handelsbenaming is.
- Verified diagnostics: `/api/rdw/lookup?plate=29-JDH-1` returns `model='Civic 4Dr Hybrid'`, catalog only has `Civic` → old UI showed blank, new UI shows full RDW string.



### Session 2026-02-26f — Auto-suspend on subscription expiry + 7/3/1-day payment reminders
- **`routes/subscription_cron.py`** new module with `POST /api/cron/subscription-sweep` (Bearer-auth via `WEBHOOK_CRON_SECRET`). Handler acks immediately and defers the sweep to a background task.
- **Sweep logic**: iterates every tenant with `subscription_expires_at` set. Computes days remaining and:
  - `days ∈ {7, 3, 1}` and stage not already in `reminder_days_sent` → emails the garage owner a "payment reminder" with escalating urgency (friendly → important → final) and adds the stage to `reminder_days_sent` so we never double-remind.
  - `days < 0` and tenant still active → sets `active=false`, stamps `suspended_at` + `suspended_reason="subscription_expired"`, sends "your subscription expired" notice (once, tracked via `"expired"` entry in `reminder_days_sent`).
- **`.emergent/crons.yml`** — added `subscription-sweep` entry running `0 8 * * *` UTC (daily at 08:00). Now 4/5 crons used.
- **Verified end-to-end**: created a tenant expiring in 3 days + a tenant expired yesterday → 401 rejected on wrong Bearer → 200 with correct secret → after sweep: expired tenant flipped to `active=false` with `suspended_at` set and `reminder_days_sent=["expired"]`; 3-day tenant got a "3 days left" email (`reminder_days_sent=["7","3"]` — the sweep sent the largest-not-yet-sent stage). Both emails logged as `accepted` in `email_logs` with purposes `subscription_expired` and `subscription_reminder`.



### Session 2026-02-26e — Multi-line pakbon (delivery note) OCR
- **`_OCR_SYSTEM` prompt rewritten** — Claude vision now returns `{plate, supplier_name, confidence, notes, parts:[{part_name, part_number, quantity, unit_cost, unit_price}, ...]}` with an explicit "EVERY ordered line" instruction. A single pakbon that lists 2/5/10 items is now captured in one scan instead of losing everything after the first row.
- **`POST /special-parts/ocr-delivery-note`** — normalises the new `parts` array through `_one_part()`, drops empty rows, and mirrors the FIRST row up to the top-level keys (`part_name`, `part_number`, `quantity`, `unit_cost`, `unit_price`) so any legacy single-part caller keeps working.
- **`DeliveryScan.jsx`** — after OCR, shows a fully editable table of every detected part with per-row checkbox (all on by default), inline name/PN/qty/cost/price editing, "Select all / Clear" shortcut, and a primary "Add N to card" bulk button that loops the checked rows into `POST /repairs/{id}/special-parts` and toasts a single "N parts added" summary at the end. The legacy single-part "Add to card" button still works for one-off corrections.
- Verified: normaliser handles both multi-part (`parts:[...]` array) and legacy (flat) responses; backend restart clean; UI renders new table and "Add 3 to card" bulk button.



### Session 2026-02-26d — Per-tenant sender identity (garage brand + Reply-To)
- **`_tenant_email_meta()`** helper — reads the garage settings (name, email, phone, address, KvK) and returns `{from_name, reply_to, footer_html}`. Falls back to platform defaults if a tenant hasn't filled in its profile.
- **`send_email(...)`** now accepts optional `from_name` and `reply_to` — the latter maps to Resend's `contact_email` (Reply-To header). The customer's inbox shows "Karam Askar Autoservice" as the sender and clicking Reply sends the response straight to `info@k-askar.nl` even though the actual From address stays on the platform-managed domain (Resend limitation — sender email is domain-locked).
- **Every send path wired up**: invoice email, overdue reminder, service reminder, and staff password-setup — each fetches its own tenant's meta before sending. Overdue + invoice HTML also gets the per-tenant footer (garage name, address, phone, email, KvK) injected before the closing `</div>` so the customer sees who to call.
- **Reminders route** (`routes/reminders.py`) — reads settings, builds the same footer inline (module runs before server.py's helper is imported) and passes `from_name` + `reply_to` to `send_email`.
- Verified end-to-end: updated PitStock tenant settings with real contact (`info@k-askar.nl`, `+31 6 12345678`, Utrecht address, KvK) → sent a service reminder → provider returned HTTP 202 → email_log row stored `accepted`; manual `curl` to Emergent proxy with `contact_email` also returned 202 confirming Reply-To is honoured.



### Session 2026-02-26c — Subscription expiry reminders (payment nudge for super_admin)
- **Tenant model** gains `subscription_expires_at` (ISO date) + `plan_started_at`. New tenants default to +14 days (trial) or +30 days (paid). Existing tenants backfilled via one-off script.
- **`GET /api/tenants/expiring?within_days=14`** — returns every garage that is already expired OR expires within N days, sorted by soonest, with a computed `days_remaining` field. Used to power the amber "needs payment attention" banner.
- **`POST /api/tenants/{id}/extend`** (body `{days: 30}`) — pushes the expiry forward by N days, snapping the base to `max(today, current_expiry)` so an already-expired garage renews from today instead of stacking on a past date. Also reactivates the tenant.
- **`SuperAdmin.jsx`** — 4th stat card "Expiring / expired", amber banner above the table listing the first 8 expiring garages with per-row **Renew 30d** button, new "Expires" column showing coloured `Nd left / expires today / expired Nd ago` badge, and a **Renew 30d** action button on every tenant row for one-click renewal after payment.
- Verified end-to-end: created a garage expiring in 3 days → appeared in `/tenants/expiring` with `days_remaining=3` → hit `/extend` with 30 days → banner cleared and expiry moved to 2026-09-27; UI screenshot shows new stat card, coloured `14d left` badge, and green "Renew 30d" buttons on every row.



### Session 2026-02-26b — Permanent garage delete (subscription cancellation)
- **`DELETE /api/tenants/{id}?purge=true`** — cascades a hard delete across every scoped collection (users, customers, vehicles, invoices, repairs, inventory, suppliers, transactions, purchase_orders, appointments, reminders, payment_methods/entries, cash_movements, public_invoice_pdfs, vehicle_events, parts_catalog, email_logs, audit_events) + `settings` (via `_id="garage:<tid>"`) + the tenant row itself. Returns per-collection counts so the UI can toast "N records removed". Default `purge=false` still soft-suspends for backwards compat.
- **`SuperAdmin.jsx` Delete button** — red destructive button next to Suspend/Enter garage on every tenant row. Opens a confirm dialog that (a) explains the cascade, (b) reminds the admin to use "Suspend" if they only want to disable login, and (c) requires the admin to retype the garage name before enabling "Delete forever".
- Verified end-to-end: created `Test Purge Garage` → soft-delete kept the row (active=false) → purge removed 1 user, 1 settings doc, 1 tenant and the tenant disappeared from `GET /tenants`. UI dialog verified with pre-typed name enabling the destructive button.



### Session 2026-02-26a — Email delivery log + one-click resend
- **`_log_email()` + refactored `send_email()`** — every send (invoice, overdue reminder, service reminder, password setup, resend) now writes a row to `db.email_logs` with `{tenant_id, to, subject, html, purpose, related_id, status: accepted|failed, provider_id, error}`. Provider response body captured on 4xx so the owner sees the REAL reason (bad address, quota, etc.) instead of a generic 502.
- **`GET /api/email-logs`** and **`POST /api/email-logs/{id}/resend`** in `routes/email_logs.py` — list newest-first with status/purpose/free-text filters (tenant-scoped for owners, all rows for super_admin) and a single-endpoint retry that reuses the stored subject + html.
- **`/email-logs` page** (`EmailLogs.jsx`, owner-only) — sidebar entry under OWNER, 3 stat cards (Total / Accepted / Failed), search + status + purpose filters, table with recipient, subject, purpose badge, delivery status pill (with error text on failure) and a per-row **Resend** button. EN / NL / AR translated.
- Verified end-to-end: created a service reminder → sent → provider returned HTTP 202 → row logged as `accepted` → Resend button re-sent successfully; page renders correctly with i18n keys resolved and tenant isolation enforced.



### Session 2026-02-25l — Staff invite QR code + copy-link dialog
- **`GET /api/users/{id}/setup-link`** (owner-only) — returns the CURRENT pending setup URL, expiry date and target email.  Idempotent: reads the existing token if still valid, only regenerates when missing or expired.  Rejects activated accounts (400) and unknown users (404).
- **`StaffInviteQrDialog`** — fetches the link on open, renders a **220×220 QR** (using the already-installed `qrcode` npm lib), shows the URL in a select-all `<code>` block with a 1-tap **Copy** button (with green checkmark feedback), plus **"Send by email"** and **"Open link"** side actions.  Expiry date shown prominently.
- **Staff page** — every pending staff row now shows a blue QR icon next to Edit / Delete (hidden on the owner's own row).  Verified 6/6 backend edge cases + UI screenshot with the QR button visible on the "QR Test Worker" row.

### Session 2026-02-25k — Impersonate garage (support drop-in)
- **`POST /api/tenants/{id}/impersonate`** (super_admin only) — issues a fresh JWT that carries an `impersonate_tenant_id` claim.  `get_current_user` reads the claim and, only if the underlying role is still `super_admin`, sets the ContextVar to the target tenant so every subsequent DB call is scoped to that garage.  Also attaches `user.impersonating = {id, name, country}` for the UI banner.
- **`POST /api/tenants/stop-impersonation`** — returns a plain super_admin JWT (claim stripped).
- **Frontend**: "Enter garage" primary button on every tenant row in `SuperAdmin.jsx`; swaps the stored token, refetches `/auth/me`, and redirects to `/` so the admin lands in the impersonated tenant's Dashboard.  Sticky amber `ImpersonationBanner` sits at the top of every page inside `DashboardLayout` with a one-click "Exit impersonation" button.
- **Security guards** — 10/10 backend edge cases green (owner → 403, missing tenant → 404, forged claim on non-super_admin token is ignored, isolated `/customers` returns only the impersonated tenant's rows).  UI E2E verified: click → banner appears + dashboard loads FR-only data, exit → banner clears + returns to `/super-admin`.

### Session 2026-02-25j — My Profile page (self-service name + email editing)
- **`PUT /api/auth/me/profile`** — accepts `{name?, email?, current_password}`. Verifies current password (rejects hijacked sessions), rejects email clashes globally (409), issues a fresh JWT after email changes so the token payload stays in sync, and stamps `profile_changed_at`. Works for super_admin, owner and staff alike (uses `_raw_db`).
- **`MyProfile.jsx` page** at `/my-profile` — avatar + role badge, editable name + email, "Save changes" opens a confirmation dialog that re-asks for the current password before persisting. Also embeds `ChangePasswordDialog` for a one-stop account panel. Role-specific banner reminds super_admin to rotate off the `platform123` seed.
- **`AuthContext.setUser`** exposed — MyProfile pushes the fresh user back into context + localStorage so the sidebar name + JWT refresh instantly without a re-login.
- **Sidebar** — added "My profile" link (with `UserCog` icon) above "Change password" for every logged-in user. Translated EN "My profile" / NL "Mijn profiel" / AR "ملفي الشخصي".
- Verified 7 backend edge cases (wrong pwd, clash, valid rename, valid email change, new-email login works, old-email fails, restore) + full-page UI screenshot.

### Session 2026-02-25i — Self-service change password
- **`POST /api/auth/change-password`** — requires the current password to prevent session-hijack tampering; rejects same-as-current and passwords under 6 chars; stamps `password_changed_at` on success. Uses `_raw_db` so it works for super_admin (no tenant context) and any per-tenant user alike.
- **`ChangePasswordDialog` component** (Sidebar footer, above "Sign out") — 3-field form with show/hide toggle, translated for EN / NL / AR (`t("changePassword")`). Visible for **every** logged-in user (super_admin, owner, staff) so the platform owner can rotate off the default `platform123` seed in production without a redeploy, and staff can change theirs after using the setup-link email.
- Verified 8 backend edge cases (wrong current, too-short, same-as-current, valid, old fails, new works, restore, no-auth) + UI screenshot confirming the dialog opens on `/super-admin` with the button in the sidebar.

### Session 2026-02-25h — Multi-tenant Phase 1b: query isolation + onboarding email + per-country defaults
- **Query isolation via `tenant_scope.py`** — a `ContextVar`-driven `TenantAwareDb` proxy that wraps 18 business collections. Every filter, `insert_one`, `update_one`, upsert, `find_one_and_update` and aggregation pipeline auto-injects `tenant_id`. `get_current_user` sets the ContextVar on each authenticated request; super_admin, background tasks, cron and startup migrations leave it unset (raw multi-tenant view). Special `_id` rewrite maps legacy `settings._id: "garage"` to `garage:<tenant_id>` — the 11 existing settings queries in server.py + routes stayed untouched.
- **Legacy settings migration at startup** — the singleton `settings._id: "garage"` doc is copied into `settings._id: "garage:<default_tid>"` (with `tenant_id` stamped) and the legacy row is deleted, so the default garage keeps its historic branding.
- **Onboarding email on new tenant creation** — `POST /api/tenants` (super_admin) now provisions the owner user with a pending-password record and fires the existing `_send_password_setup_email` flow. Response includes `{onboarding: {email, link, emailed}}` so the super_admin can copy the link if the SMTP proxy is down. Verified end-to-end: created FR "Isolation Test Garage" → owner set password via link → logged in → saw 0 customers (fully isolated).
- **Country-driven settings defaults** — `COUNTRY_DEFAULTS` matrix (NL/BE/DE/FR/ES/IT/GB/TR/MA/SA/AE/EG) applied on tenant creation: tax_rate, currency_symbol/code, plate_country, and feature toggles (`rdw`, `kvk`, `ideal_qr`). Berlin Auto (DE) got 19% VAT + €; Isolation Test Garage (FR) got 20%; Riyadh Auto (SA) would get 15% + ﷼.
- **Cross-tenant leak test passed** — FR owner created "FR-only Customer" → default owner's customer list count stayed at 6 and did NOT include the FR customer (`[False]*6`).

### Session 2026-02-25g — Multi-tenant SaaS foundation (Phase 1)
- **Data model**: new `tenants` collection with `{id, name, country, plan, active, owner_email, created_at}`. Every business collection now carries a `tenant_id` field, back-filled to a seeded default tenant `PitStock Garage` for the historic dataset.
- **Auth**: new `super_admin` role that transcends tenants; `require_owner` widened to accept super_admins too so the platform owner can drill into any garage without impersonation. New `require_super_admin` guard for platform endpoints.
- **Endpoints** (routes/tenants.py): `GET /api/tenants` (super_admin), `POST /api/tenants` (super_admin, auto-provisions per-tenant settings doc), `PUT /api/tenants/{id}`, `DELETE /api/tenants/{id}` (soft-delete), `GET /api/tenants/{id}/stats` (counts), `GET /api/tenants/me` (any user).
- **Seeded platform admin**: `platform@pitstock.app` / `platform123` (env-overridable) — separate from per-garage owner. All historic users/customers/vehicles/invoices/repairs/etc. now carry `tenant_id`.
- **Frontend Super Admin dashboard** (`/super-admin`, super_admin-only route): total/active/suspended counters, garages table, "New garage" dialog with country + plan pickers, one-tap Suspend/Reactivate. Sidebar shows a dedicated "Platform · Garages" section when the current user is super_admin.
- **Deliberately deferred to Phase 1b** (next session): actual per-tenant query filtering on the ~150 existing endpoints. Today super_admin sees the whole platform, owner still sees everything in their DB — the isolation middleware ships in Phase 1b after a testing-agent regression pass.

### Session 2026-02-25f — PDF attachments on email/WhatsApp + bulk reminder dispatch
- **Invoice emails now carry the PDF as a real attachment** — `send_email` accepts `attachments=[{filename, content_base64}]` and forwards to the Resend proxy. `InvoiceEmailBody` gained `attachment_base64` + `attachment_filename`. Frontend `sendEmail` renders the invoice via `htmlToPdfBlob` (same look as the "Download PDF" action), base64-encodes the blob, and ships it in the POST body — customers now receive a downloadable file, not just an HTML summary.
- **WhatsApp share now includes a public PDF link** — new endpoints `POST /api/invoices/{id}/public-pdf` (auth, base64 in) and `GET /api/public/invoice-pdf/{token}` (no auth, 30-day expiry). Frontend WhatsApp button uploads the freshly rendered PDF, gets a public URL back, and drops it into the wa.me message so customers can tap the link to download.
- **"Send all pending" bulk reminder dispatch** — new `POST /api/reminders/send-all-pending` iterates every pending reminder with an email, dispatches via the existing `_send_reminder` background task, and returns `{queued, skipped, total}`. Reminders page gained a primary button with a live badge showing the pending-with-email count (currently `2`). Skipped counts include reminders without email (WhatsApp them one-by-one from the row action).

### Session 2026-02-25e — server.py partial refactor into routes/
- **Extracted 4 self-contained modules from `server.py` → `/app/backend/routes/`** to unblock the "monolithic 4400-line server.py" pain point without touching the higher-risk auth/repairs/invoices core paths. New files:
  - `routes/rdw.py` — `/api/rdw/lookup` (public NL plate open-data)
  - `routes/kvk.py` — `/api/kvk/lookup` (Dutch Chamber of Commerce)
  - `routes/reminders.py` — Reminder + ReminderCreate models, `_reminder_html`, `_send_reminder`, and all 6 `/api/reminders/*` endpoints
  - `routes/cron.py` — `/api/cron/reminders` + `/api/cron/backup` (Bearer-token protected)
- Each module exposes a `register(...)` factory that returns an `APIRouter`, mirroring the existing `backup.py`/`extras.py` pattern (no circular imports, deps injected).
- `server.py` shrank from **4438 → 4082 lines** (-356). Verified live: reminders list works, RDW returns Nissan Pixo 2011, KvK returns configured 501 message, cron endpoints correctly reject 401.

### Session 2026-02-25d — Workboard card redesign
- **CardChip redesigned for readability inside the narrow 7-column week grid** — previously card_number and vehicle collapsed to "J..." in the mechanic × day cells. New stacked layout: top bar (card_number + priority flame + hours pill), hero row (plate badge), vehicle make/model/year row, customer row with user icon, footer with status pill + APK/OIL alert pills. Left-border accent stripe for priority. `context="sidebar"` shows the target mechanic hint (`→ khaled`) only in the unassigned queue (redundant inside a mechanic column). Presenter/compact mode collapses to a single-line pill with plate + vehicle + hours for wall-display readability.

### Session 2026-02-25c — reminders UX + workboard auto-assign + password setup wiring
- **Reminders: WhatsApp + Email action buttons on every pending reminder** — replaced the single "Send now" button with two: `Email` (uses existing Resend flow) and `WhatsApp` (opens wa.me with a pre-filled message and marks the reminder as sent). Backend `Reminder.channel` widened to `email | whatsapp | manual` and new endpoint `POST /api/reminders/{id}/mark-sent` accepts `{channel}` to flip status → sent + record channel. Also added dynamic auto-refresh: `refetchInterval: 20s` + `refetchOnWindowFocus`, so rows flip Pending → Sent without a manual page reload.
- **Workboard: new job cards auto-land on their assigned mechanic** — `POST /api/repairs` now sets `scheduled_date = today` automatically when a `mechanic_id` is picked at creation time (so the card appears in the mechanic's Today column right away instead of sitting in "Niet-toegewezen"). CardChip now shows the mechanic name inline with a wrench icon on every chip — including chips in the unassigned queue — so staff instantly see which colleague the card is destined for.
- **Staff Password Setup: public `/setup-password/:token` route wired into `App.js`** — the pre-built `PasswordSetup.jsx` page is now reachable outside the ProtectedShell so newly-invited staff can open the email link and pick their own password. Verified: invalid tokens render the Dutch "Link ongeldig of al gebruikt" error card; the backend `_password_setup_link` already emits `${APP_PUBLIC_URL}/setup-password/{token}`.

### Session 2026-02-25b — PDF pagination bug (visual distortion)
- **Fix: Invoice PDF no longer shows duplicated "Thank you for choosing us!" footer, half-cut SEPA block, or an empty page 2** — rewrote `/app/frontend/src/lib/pdf.js` `canvasToPdf` to (1) trim trailing whitespace via `findLastContentRow`, (2) skip empty pages via `bandHasInk`, (3) smart-cut at the nearest blank row via `findNearestBlankRow`, and (4) fast-path squeeze the whole doc into one page when it is ≤ 110 % of A4 height instead of breaking through a text line. Verified with 3 real invoices (2, 2, 7 lines) — all render as a single clean page with QR, plate, totals and footer intact.

### Session 2026-02-25 — critical bug fixes
- **Fix: `/api/permissions/catalog` was broken** — the endpoint had a dangling decorator with no function body, so both `/permissions/catalog` and `/users` pointed at `list_users`. The Staff "Edit" dialog rendered an empty permission matrix ("0/0 صلاحية ممنوحة"). Added a proper handler that returns `{sections: PERMISSION_CATALOG}`.
- **Add: `/api/rdw/lookup?plate=XXX`** — the frontend called this endpoint but it never existed in the backend (only referenced in `CustomerVehiclesEditor.jsx`). Implemented via `opendata.rdw.nl` open data: returns `{plate, make, model, year, color, apk_expiry, fuel, vehicle_type}` with plate reformatted to Dutch dashes (KK-555-D). Verified live (Renault Clio, Nissan Pixo).
- **iDEAL / SEPA QR made visible in Settings** — added `<SepaQrPreview>` live preview component in `/settings` that renders a real EPC069-12 GiroCode QR the moment IBAN is filled; amber warning banner shown when IBAN is empty; QR toggle block moved into a primary-accented card with a `QrCode` icon.

### Session 2026-02 fork agent — big batch
- **Country-aware license plates everywhere** — plate strip color/label driven by `vehicle.car_country`. Fixed callers in Repairs/Dashboard + `/api/dashboard/summary` now includes car_country.
- **Parts Return workflow (stock + special)** — added `returned/returned_at/return_reason` on both `PartUsed` and `SpecialPart`; four endpoints `POST /api/repairs/{rid}/parts/{txn}/return` + `/unreturn` and `POST /api/repairs/{rid}/special-parts/{sp}/return` + `/unreturn`. Returned parts stay on the card in RED (line-through + `RETURNED` badge) but are excluded from totals; stock parts also restock inventory and log compensating IN/OUT txns. Un-return reverses with stock guard.
- **Customer discount per job card** — `discount_type` (`amount` | `percent`) + `discount_value` fields on RepairCard. `_recalc_repair` applies discount pre-tax with pro-rata BTW. `discount_amount` persisted for reports.
- **Excel Export on Cash Register** — new "Export Excel" button uses `xlsx` (SheetJS) with currency formatting.
- **Modern Job Card PDF redesign** — `buildRepairCardHtml` rewritten with light-blue header band, inline country-aware plate badge, status pill, quote-block for complaint, parts-count-vs-total footer. Returned parts (**both stock and special**) render in red with strike-through. Discount line shown in totals when amount > 0.
- **Job Card modal redesign** — removed logo band, added compact gradient header with icon + card number + status, redesigned Customer + Vehicle cards (email/address rows, live country dropdown, inline plate badge in header), 3-column colour-coded Repair log (complaint red · diagnosis amber · workDone green), full discount UI in totals block.
- **A4 Delivery-Note live camera** — replaced `capture="environment"` file input with a proper in-app camera dialog using `navigator.mediaDevices.getUserMedia`. Live rear-camera video + A4 framing guide + Capture/Upload/Close buttons. Falls back to file picker when getUserMedia unsupported.
- **Bug fixes from Iteration 14 testing** — (a) `DELETE /parts/{txn}` no longer double-restocks after a return and cleans up orphan RETURN IN transaction; (b) Cash Register "ref_undefined" typo now shows `—`; (c) Dashboard plate country flows through.

### Prior sessions (rolled up)
- Smart Address (NL postcode auto-fetch) + cascading make/model/year dropdowns
- Loyalty credit auto-discount + Car Passport QR (public timeline)
- Live Bay Board with deep-links + CSV fleet import
- Delivery-note A4 OCR via Claude Sonnet 4.6 Vision (emergentintegrations)
- Cash Register unified ledger (cash/bank/card, IN/OUT, filters)
- Arabic RTL letter shaping + Repairs modal 8-section design
- Twilio SMS fallback + WhatsApp invoice sharing
- iDEAL/SEPA QR code, labor time-clock, calendar-based appointment booking
- Overdue invoice email reminders with escalating tone

## Backlog / Roadmap
- **P0** — Refactor monolithic `server.py` (~3.8k lines) into `/backend/routes/`.
- **P0** — Full Arabic translation of the Invoice modal + Invoice PDF.
- **P1** — Twilio SMS service reminders (email → SMS fallback).
- **P1** — Supplier-return tracker page: all returned parts with "credit note received" toggle.
- **P2** — Excel export on Invoices + Purchase Orders + Repairs listing.
- **P2** — Cost-basis fix on the compensating RETURN IN txn (currently logged at selling price).
- **P2** — Owner-only guard on the return endpoints + audit trail.

## Health
- Broken: none.
- Mocked: none.
- Backend endpoints verified via curl: `/api/repairs/{}/parts/{}/return + /unreturn` (195→135→195), `/api/repairs/{}/special-parts/{}/return + /unreturn` (149.85→74.93→149.85), PUT `/api/repairs/{}` with discount payload (150→135 at 10%).
- Frontend verified via screenshot: redesigned modal, Cash Register export button, live A4 camera dialog with framing guide.

## Credentials
`/app/memory/test_credentials.md` — admin@garage.com / admin123
