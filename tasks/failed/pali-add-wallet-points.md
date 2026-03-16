# Task: Add wallet points endpoint

## 🔨 Implementation

צור endpoint: `POST /api/wallet/add-points`

**קבל body:**
```ts
{ userId: string, amount: number }
```

**דרישות מימוש:**
- וודא שה-`userId` בבקשה שייך ל-session הנוכחי (authentication)
- השתמש ב-atomic update ישירות ב-SQL: `points = points + $amount` — לא fetch ואז write
- בדוק את תוצאת ה-update — אם לא עודכנה שורה (rowCount = 0), זרוק שגיאה 404
- החזר: `{ success: true, newBalance: number }`

**validation:**
- `amount` חייב להיות מספר חיובי — אם לא, החזר 400
- `userId` חייב להיות non-empty string — אם לא, החזר 400

## ✅ Review Criteria

- [ ] endpoint קיים ומגיב על POST /api/wallet/add-points
- [ ] authentication — userId בבקשה חייב להתאים ל-session (לא ניתן לעדכן ארנק של משתמש אחר)
- [ ] update הוא atomic: `points = points + amount` בשאילתת SQL אחת — לא fetch + calculate + write
- [ ] אם ה-update לא עדכן שורה — מחזיר 404
- [ ] amount שלילי או אפס מחזיר 400
- [ ] userId ריק מחזיר 400
- [ ] newBalance בתשובה הוא הערך החדש מה-DB (לא חישוב לוקאלי)
- [ ] אין console.log מיותרים
- [ ] הקוד תואם לסגנון הקיים ב-CONTEXT.md