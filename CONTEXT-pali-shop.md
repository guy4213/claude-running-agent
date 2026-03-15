# Project Context — PALI Shop

## Project Name
PALI Shop — Wallet, Referral & Hidden Store System

## Purpose
A B2C e-commerce platform with a built-in referral engine and digital wallet.
Users get unique referral links, earn points on purchases, and redeem them via a wallet.
The store is "hidden" — accessible only via personalized referral URLs.
Admins manage products, colors, logos, and conversion ratios per product.

## Tech Stack
- Frontend: React (TypeScript)
- Backend: Node.js (TypeScript)
- Database + Auth: Supabase (PostgreSQL + RLS)
- Deploy: Vercel (frontend) / Render (backend)
- Notifications: SMS + Email (automated on sale events)

## Key Features
- Wallet system: points accumulation, redemption, duplicate prevention
- Referral Engine: unique links per user, real-time conversion tracking
- Hidden store: dynamic landing page per referral URL
- Admin Console: manage products, colors, logo, conversion ratios
- Live dashboard: clicks, purchases, wallet balance per referrer
- Auth: Super Admin / Admin / User roles via Supabase RLS

## Folder Structure
```
/
├── src/
│   ├── components/       ← React UI components
│   ├── pages/            ← Route-level pages
│   ├── services/         ← API call wrappers
│   ├── hooks/            ← Custom React hooks
│   └── utils/
├── server/               ← Node.js backend (if monorepo)
│   ├── routes/
│   ├── controllers/
│   └── services/
├── tasks/                ← Claude task files go here
├── tasks/completed/
└── CONTEXT.md
```

## Conventions
- File naming: camelCase for files, PascalCase for components
- Async style: async/await everywhere, no raw `.then()` chains
- Error handling: try/catch in all async functions
- Comments: Hebrew is fine (matches existing code)
- All new files: TypeScript only

## Patterns to Follow
- Supabase RLS enforces data isolation between users — never bypass it
- Wallet operations must be atomic — use Supabase transactions
- Referral link format: `/ref/:uniqueCode` — don't change the URL structure
- Admin-only routes must check role from Supabase auth session

## What to Avoid
- Don't add new npm packages without noting it in summary.txt
- Don't touch RLS policies without explicit instruction
- Don't expose wallet balance or referral data across users
- Don't refactor working code outside the task scope

## Environment Variables (names only)
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY

## Current Status
Mid-development. Phase A (Wallet + Referral engine) is the core.
Frontend and Admin Console are Phase B.