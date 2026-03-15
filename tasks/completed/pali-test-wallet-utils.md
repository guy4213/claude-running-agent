# Task: Wallet Points Calculator Utility

Create a new file at `src/utils/walletUtils.ts`.

The file should export the following functions:

## 1. `calculatePoints`
- Receives: `purchaseAmount: number` (in NIS)
- Returns: `number` — points earned (1 point per 10 NIS, rounded down)
- Example: 95 NIS → 9 points

## 2. `calculateDiscount`
- Receives: `points: number`, `conversionRate: number` (NIS per point, default = 0.5)
- Returns: `number` — discount amount in NIS
- Example: 20 points × 0.5 = 10 NIS discount

## 3. `canRedeem`
- Receives: `points: number`, `minimumRequired: number` (default = 10)
- Returns: `boolean` — whether the user has enough points to redeem

Include JSDoc comments in Hebrew for each function.
Export all three as named exports.