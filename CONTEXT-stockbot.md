# Project Context — StockBot

## Project Name
StockBot — Automated Stock Earnings Analysis Bot

## Purpose
A cron-based bot that monitors publicly traded companies' earnings reports,
filters stocks by financial criteria (market cap, growth, etc.), runs AI analysis,
and sends Hebrew-language summaries via Telegram and email.
Deployed on Render. Runs automatically — no manual intervention needed.

## Tech Stack
- Runtime: Node.js + TypeScript
- Scheduler: node-cron (runs every 30 min)
- Financial data: Financial Modeling Prep (FMP) API
- AI analysis: OpenAI / Grok / Gemini (interchangeable)
- Notifications: Telegram (node-telegram-bot-api, send-only — no polling) + Nodemailer (Gmail)
- Deploy: Render (always-on service)
- No frontend

## Key Features
- Earnings monitoring: fetches upcoming + recent earnings from FMP
- Market cap filtering: ignores micro/nano caps below threshold
- BMO/AMC time window logic: Before Market Open / After Market Close handling
- AI-generated Hebrew analysis summary per stock
- Telegram: send-only bot (no polling, no webhook — avoids 409 conflicts on Render)
- Email: Gmail via Nodemailer
- Tracks previously sent reports to avoid duplicates (previouslySentReports.json)
- IR portal discovery: two-phase system to find investor relations pages + earnings PDFs

## Folder Structure
```
/
├── src/
│   ├── app.ts                ← entry point, cron schedule
│   ├── controllers/
│   │   └── mainController.ts ← orchestrates the full flow
│   ├── services/
│   │   ├── telegramService.ts
│   │   ├── emailService.ts
│   │   ├── aiService.ts      ← OpenAI/Grok/Gemini calls
│   │   ├── fmpService.ts     ← FMP API integration
│   │   └── irService.ts      ← IR portal discovery
│   ├── types/                ← TypeScript interfaces (StockData, etc.)
│   ├── utils/
│   │   └── logger.ts
│   └── data/
│       └── previouslySentReports.json  ← persisted on Render disk
├── tasks/
├── tasks/completed/
└── CONTEXT.md
```

## Conventions
- TypeScript strict mode
- All async: async/await, no callbacks
- Logging: always use logger.ts, not raw console.log
- Comments: Hebrew is fine
- Telegram: NEVER add polling. Bot is send-only. This is intentional.

## Patterns to Follow
- Cron in app.ts, logic in mainController.ts — keep separation
- StockData type must be used for all stock objects — don't pass raw API responses around
- AI summary always goes to `stockData.aiSummery` field (note: typo is intentional, already used everywhere)
- previouslySentReports.json path is `./previouslySentReports.json` from project root at runtime

## What to Avoid
- NEVER add `{ polling: true }` to TelegramBot — causes 409 errors on Render
- Don't change the cron schedule without explicit instruction
- Don't add new AI providers without updating the aiService abstraction
- Don't hardcode stock symbols — filtering is dynamic via FMP

## Environment Variables (names only)
FMP_API_KEY
OPENAI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
GOOGLE_APP_EMAIL
GOOGLE_APP_PASSWORD
EMAIL_TO
PORT

## Current Status
Deployed and running on Render.
Core flow works: earnings fetch → filter → AI analysis → Telegram + email.
IR portal discovery system is built (two-phase: portal find + PDF extract).