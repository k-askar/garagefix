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
- JWT auth with seeded admin (admin@garage.com / admin123)
- Inventory CRUD with auto-SKU + auto-barcode + printable Code128 labels
- Stock IN / OUT with supplier/customer selection, quantity validation, cost auto-update on IN
- Webcam barcode scanner + manual lookup by SKU/barcode
- Suppliers & Customers directories
- Transactions ledger with filters
- Dashboard: stock value, units, low-stock, today's flow, 14d movement line chart, top movers, action panel for low-stock parts
- Reports: 30d movement bar chart + value-by-category donut

## Backlog (P1)
- Multi-user staff invites + role-based UI gates
- CSV import/export of inventory
- Purchase orders with pending IN receipts
- Invoice/receipt generation for Stock OUT
- Vehicle-specific parts filter with fuzzy matching

## Next Tasks
See finish summary.
