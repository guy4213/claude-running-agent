# Task: Add wallet points endpoint

## 🔨 Implementation

- צור endpoint: `POST /api/wallet/add-points`
- קבל body: `{ userId: string, amount: number }`
- עדכן את טבלת `wallets` ב-Supabase — הוסף את ה-amount לעמודת `points`
- החזר: `{ success: true, newBalance: number }`
- הוסף validation: amount חייב להיות מספר חיובי

## ✅ Review Criteria

- [ ] endpoint קיים ומגיב על POST /api/wallet/add-points
- [ ] קלט תקין מחזיר 200 + newBalance מעודכן
- [ ] amount שלילי מחזיר 400 עם הודעת שגיאה
- [ ] userId שלא קיים מחזיר 404
- [ ] הנתון נשמר בפועל ב-Supabase (בדוק את הלוגיקה, לא חיבור אמיתי)
- [ ] אין console.log מיותרים
- [ ] הקוד תואם לסגנון הקיים ב-CONTEXT.md