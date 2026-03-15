# Project Context — Diamond B2B Platform

## Project Name
Diamond AI — B2B Diamond Trading Platform with Optical Fingerprinting

## Purpose
A B2B marketplace for diamond traders that uses AI to create a unique "optical fingerprint"
for each diamond via OpenAI Vision API. Sellers register a diamond (3 photos → fingerprint),
buyers can verify authenticity at any point in the supply chain.
Replaces a previous Bubble.io + Make.com setup with a fully custom solution.

## Tech Stack
- Frontend: React (TypeScript)
- Backend: Node.js (TypeScript) + Express
- Database: Supabase (PostgreSQL + pgvector extension)
- AI: OpenAI Vision API (GPT-4o Vision) — extracts keypoint JSON from macro images
- Image processing: sharp (server-side compression before sending to OpenAI)
- Vector similarity: pgvector (cosine similarity for fingerprint matching)
- Deploy: Render (backend), Vercel (frontend)

## Key Features
- Onboarding: 3 images → sharp compress → OpenAI Vision → JSON keypoints → float[512] vector → pgvector storage
- Verification: new photo → extract vector → cosine similarity vs stored → score ≥ 0.85 = Verified
- Confidence handling: if AI returns confidence < 0.6 → reject with user instructions
- Rate limiting on verify endpoint (brute-force prevention)
- Idempotency: re-onboarding same diamond_id → 409 + existing record
- Auth: Supabase roles (seller / buyer / admin)
- RLS prevents direct access to raw fingerprint vectors

## Folder Structure
```
/
├── src/
│   ├── routes/           ← Express routes (diamonds, auth, verify)
│   ├── controllers/      ← Business logic per route
│   ├── services/
│   │   ├── aiService.ts      ← OpenAI Vision calls
│   │   ├── vectorService.ts  ← pgvector operations
│   │   └── imageService.ts   ← sharp compression
│   ├── middleware/        ← rate limiting, auth guards
│   └── utils/
├── client/               ← React frontend
├── tasks/
├── tasks/completed/
└── CONTEXT.md
```

## API Endpoints
- POST /auth/signup
- POST /diamonds/onboard         ← multipart/form-data (3 images + metadata)
- GET  /diamonds                 ← catalog with pagination + filters
- GET  /diamonds/:id
- POST /diamonds/:id/verify      ← new image → similarity check
- GET  /diamonds/:id/logs        ← verification history

## Conventions
- All new files: TypeScript only
- Image always compressed via sharp before any AI call — mandatory, reduces OpenAI costs
- OpenAI response must be parsed as JSON — always validate schema before saving
- Vector stored as float[512] in pgvector column `fingerprint`
- Raw JSON keypoints stored separately in `fingerprint_raw` for debugging
- Comments: Hebrew or English both OK

## Patterns to Follow
- Fingerprint extraction prompt is fixed — don't change it without explicit instruction
- Similarity threshold is 0.85 — don't hardcode a different value
- All DB writes go through controllers, never directly from routes
- Return `{ score, status, breakdown }` from verify endpoint — keep this shape

## What to Avoid
- Don't bypass RLS on fingerprint vectors
- Don't skip image compression — always run sharp before OpenAI
- Don't change the similarity threshold without explicit instruction
- Don't add heavy dependencies — sharp + pgvector + OpenAI is the established stack

## Environment Variables (names only)
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
PORT

## Current Status
MVP architecture is defined and partially built.
Core flows: onboarding + verification. Admin panel and catalog are next.