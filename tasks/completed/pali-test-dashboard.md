# Task: pali-test-dashboard utility function

Please create a new file named `src/utils/dashboardLogic.ts`.

Implement a function named `getDashboardStats` that:
1. Receives an array of test objects: `{ id: string, name: string, status: 'pass' | 'fail' | 'pending' }`.
2. Returns a summary object: `{ total: number, passed: number, failed: number, successRate: string }`.
3. The `successRate` should be the percentage of passed tests out of total tests (e.g., "85%").

Requirements:
- Export the function as a named export.
- Write JSDoc comments in Hebrew.
- Create a `summary.txt` file in Hebrew explaining the function logic.