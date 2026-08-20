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

## Admin Seed
- **Owner**: admin@garage.com / admin123
- **Staff**: mike@garage.com / mike1234

## Files of note
- `/app/backend/server.py`
- `/app/frontend/src/i18n/index.jsx` (EN/NL/AR dictionaries)
- `/app/frontend/src/lib/pdf.js` (html2canvas + jsPDF)
- `/app/frontend/src/lib/reports.js` (list & repair-card report builders)
- `/app/frontend/src/lib/barcode-batch.js` (label grid)
