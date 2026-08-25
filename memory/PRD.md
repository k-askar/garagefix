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
