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

## Implemented (highlights, latest first)

### Session 2026-02 (fork agent — big-batch update)
- **Country-aware license plates everywhere** — plate strip color/label now driven by `vehicle.car_country` (was hard-coded NL yellow). Fixed callers in Repairs/Dashboard + fixed `/api/dashboard/summary` to include car_country in the open_cars projection.
- **Parts Return workflow (stock + special)** — added `returned/returned_at/return_reason` on both `PartUsed` and `SpecialPart`; four new endpoints `POST /api/repairs/{rid}/parts/{txn}/return` + `/unreturn` and `POST /api/repairs/{rid}/special-parts/{sp}/return` + `/unreturn`. Returned parts stay on the card in RED (line-through) but are excluded from totals; stock parts also restock inventory and log compensating IN/OUT txns. Un-return reverses everything with a stock guard.
- **Customer discount per job card** — `discount_type` (`amount` | `percent`) + `discount_value` fields on RepairCard. `_recalc_repair` applies discount pre-tax, and BTW is on the discounted taxable base (pro-rata). Persisted `discount_amount` for reports.
- **Excel Export on Cash Register** — new "Export Excel" button uses `xlsx` (SheetJS) to export the currently filtered ledger entries with currency formatting.
- **Modern Job Card PDF redesign** — `buildRepairCardHtml` rewritten with light-blue header band, inline country-aware plate badge, status pill, quote-block for complaint, and parts-count-vs-total footer. Returned parts render in red with strike-through in the PDF too.
- **Job Card modal redesign** — removed logo band, added compact gradient header with icon + card number + status, redesigned Customer + Vehicle cards (email/address rows, live country dropdown, inline plate badge in header), 3-column colour-coded Repair log (complaint = red · diagnosis = amber · workDone = green), full discount UI in totals block.
- **A4 Delivery-Note live camera** — replaced the `capture="environment"` file input with a proper in-app camera dialog using `navigator.mediaDevices.getUserMedia`. Displays live rear-camera video with an A4 framing guide, has Capture/Upload/Close buttons, and falls back to file picker when getUserMedia isn't available.
- **Bug fixes from Iteration 14 testing** — (a) `DELETE /parts/{txn}` no longer double-restocks after a return and also cleans up the orphan RETURN IN transaction; (b) Cash Register "ref_undefined" typo now shows `—` when reference_type is missing; (c) Dashboard plate country now flows through from the backend.

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
- **P1** — Twilio SMS service reminders (email → SMS fallback when customer has no email).
- **P1** — Supplier-return tracker page: single view of all returned parts with a "credit note received" toggle.
- **P2** — Excel export on Invoices + Purchase Orders + Repairs listing.
- **P2** — Cost-basis fix on the compensating RETURN IN txn (currently logged at selling price).
- **P2** — Owner-only guard on the return endpoints + audit trail beyond the txn note.

## Health
- Broken: none.
- Mocked: none.
- Backend endpoints verified via curl this session: `/api/repairs/{}/parts/{}/return + /unreturn`, `/api/repairs/{}/special-parts/{}/return + /unreturn`, PUT `/api/repairs/{}` with discount payload — all round-trip cleanly.
- Frontend verified via screenshot: redesigned modal (top + bottom), Cash Register export button, live A4 camera dialog.

## Credentials
`/app/memory/test_credentials.md` — admin@garage.com / admin123
