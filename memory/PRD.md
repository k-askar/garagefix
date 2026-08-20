# PitStock — Garage Inventory Management (PRD)

## Original Problem
"I own a car garage and I want to manage my inventory in terms of both incoming and outgoing stock, know the cost and selling price of each item, create barcodes for the items, track material balances, determine repurchase points, and manage all other inventory-related data."

## User Choices
- Auth: Simple JWT login (owner + staff roles)
- Barcodes: Auto-generated (Code128, 12 digits) + webcam scanning (html5-qrcode) + manual entry
- Currency: EUR (€), Language: English
- Design: Modern, simple, clear — dark industrial "Performance Pro" theme

## Architecture
- Backend: FastAPI + Motor + MongoDB, JWT (PyJWT), bcrypt
- Frontend: React + React Router 7 + TanStack Query + Tailwind + Shadcn UI + recharts + react-barcode + html5-qrcode
- Fonts: Chivo (display) + IBM Plex Sans (body) + IBM Plex Mono (data)

## Personas
- **Garage Owner** — full control, manages parts, suppliers, customers, reports
- **Staff** — logs stock movements, looks up parts via scanner

## Implemented (2026-02)
- JWT auth with seeded admin (admin@garage.com / admin123) + owner-only role guards
- Inventory CRUD with auto-SKU + auto-barcode + printable Code128 labels
- **Auto-open barcode label dialog after creating a new part**
- **Multilingual UI: English, Nederlands (Dutch), العربية (Arabic RTL) with persistent selection**
- **CSV Import + Template download for bulk inventory ingestion (owner only)**
- **Vehicle Search** filter on Inventory (matches compatible_vehicles)
- **Receipt printing** on Stock OUT (via sonner action) + printer icon on OUT rows in Transactions ledger
- **Staff Accounts** page — owner invites/removes users; staff role prevented from editing/deleting inventory or accessing settings/users
- **Garage Settings** page (name, address, phone, tax_id, footer note) used on printed receipts
- **CSV Export** of inventory + transactions from Reports page
- Stock IN / OUT with supplier/customer selection, quantity validation, cost auto-update on IN
- Webcam barcode scanner + manual lookup
- Suppliers & Customers directories, Transactions ledger with filters
- Dashboard: KPIs + 14d movement + top movers + low-stock action panel
- Reports: 30d movement bar + value-by-category donut

## Backlog (P1)
- Multi-user staff invites + role-based UI gates
- CSV import/export of inventory
- Purchase orders with pending IN receipts
- Invoice/receipt generation for Stock OUT
- Vehicle-specific parts filter with fuzzy matching

## Next Tasks
See finish summary.
