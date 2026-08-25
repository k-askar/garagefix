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
