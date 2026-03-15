const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios'); // חובה להתקין: npm install axios

// הגדרות טלגרם - תחליף בפרטים שלך
const TELEGRAM_TOKEN = '8651652432:AAFfuiITIdBHXrSgO9ubASezP5Ms6S1jqxw';
const TELEGRAM_CHAT_ID = '5657105510';

// הגדרות נתיבים
const TASKS_DIR = path.join(__dirname, 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');
const MAX_TASKS_PER_RUN = 2;

/**
 * שולח הודעה לטלגרם
 */
async function sendTelegram(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error('❌ Telegram Notification Failed:', e.message);
    }
}

/**
 * מריצה פקודת טרמינל ומחזירה את הפלט שלה
 */
function runCommand(command) {
    try {
        console.log(`\n[🏃 Running]: ${command}`);
        const output = execSync(command, { stdio: 'inherit', encoding: 'utf-8' });
        return { success: true, output };
    } catch (error) {
        console.error(`\n[❌ Failed]: ${command}`);
        return { success: false, error: error.message };
    }
}

/**
 * פונקציית האוטומציה המרכזית
 */
async function executeTasksBatch() {
    console.log('\n=== Starting Claude Automation Batch ===');
    
    let report = `🤖 *דיווח בוקר - סוכן קלוד*\n\n`;
    let tasksHandled = 0;

    if (!fs.existsSync(COMPLETED_DIR)) fs.mkdirSync(COMPLETED_DIR, { recursive: true });

    const allFiles = fs.existsSync(TASKS_DIR) ? fs.readdirSync(TASKS_DIR) : [];
    const pendingTasks = allFiles.filter(file => file.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, file)).isDirectory());

    if (pendingTasks.length === 0) {
        // אל תשלח הודעה אם אין משימות כדי לא להציק בבוקר
        console.log('No tasks found.');
        return;
    }

    const tasksToProcess = pendingTasks.slice(0, MAX_TASKS_PER_RUN);
    
    // הכנה בסיסית בגיט
    runCommand('git checkout main');
    runCommand('git pull origin main');

    for (const taskFile of tasksToProcess) {
        tasksHandled++;
        const timestamp = Date.now();
        const branchName = `feature/auto-${taskFile.replace('.md', '')}-${timestamp}`;
        
        report += `📄 *משימה:* ${taskFile}\n`;

        // יצירת בראנץ'
        if (!runCommand(`git checkout -b ${branchName}`).success) {
            report += `❌ נכשל: לא הצלחתי ליצור בראנץ'.\n\n`;
            continue;
        }

        // הרצת קלוד
        const claudePrompt = `"Read tasks/${taskFile}. Implement the requirements in the codebase. Do not ask for any user input or confirmation. When you are done, just exit."`;
        const claudeResult = runCommand(`npx claude -p ${claudePrompt} --dangerously-skip-permissions`);

        if (claudeResult.success) {
            const status = execSync('git status --porcelain', { encoding: 'utf-8' });
            
            if (status.trim().length > 0) {
                runCommand('git add .');
                runCommand(`git commit -m "Auto-commit: Implemented ${taskFile}"`);
                runCommand(`git push -u origin ${branchName}`);
                
                // העברה לארכיון
                const oldPath = path.join(TASKS_DIR, taskFile);
                const newPath = path.join(COMPLETED_DIR, taskFile);
                if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);

                report += `✅ *הושלם!* נוצר בראנץ': \`${branchName}\`\n\n`;
            } else {
                report += `⚠️ הסתיים ללא שינויי קוד.\n\n`;
            }
        } else {
            report += `❌ נכשל: שגיאה בהרצת קלוד.\n\n`;
        }

        runCommand('git checkout main');
    }

    report += `🏁 סיימתי לעבור על התור.`;
    
    // שליחת הדו"ח הסופי לטלגרם
    await sendTelegram(report);
}

// תזמון קרון ל-08:00 בבוקר
cron.schedule('0 8 * * *', () => {
    executeTasksBatch();
});

console.log('🤖 Claude Manager is active. Waiting for 08:00 AM...');

// הרצה מיידית לטסט
executeTasksBatch();