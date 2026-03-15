const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// הגדרות נתיבים - מותאם לווינדוס
const TASKS_DIR = path.join(__dirname, 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');
const MAX_TASKS_PER_RUN = 2;
async function sendTelegram(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error('❌ Telegram failed:', e.message);
    }
}

function runCommand(command) {
    try {
        console.log(`\n[🏃 Running]: ${command}`);
        execSync(command, { stdio: 'inherit', encoding: 'utf-8' });
        return true;
    } catch (error) {
        console.error(`\n[❌ Failed]: ${command}`);
        return false;
    }
}

async function executeTasksBatch() {
    let finalReport = `🤖 *דיווח בוקר מפורט - סוכן קלוד*\n\n`;
    
    if (!fs.existsSync(COMPLETED_DIR)) fs.mkdirSync(COMPLETED_DIR, { recursive: true });

    const allFiles = fs.existsSync(TASKS_DIR) ? fs.readdirSync(TASKS_DIR) : [];
    const pendingTasks = allFiles.filter(file => file.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, file)).isDirectory());

    if (pendingTasks.length === 0) return;

    runCommand('git checkout main');
    runCommand('git pull origin main');

    for (const taskFile of pendingTasks.slice(0, MAX_TASKS_PER_RUN)) {
        const timestamp = Date.now();
        const branchName = `feature/auto-${taskFile.replace('.md', '')}-${timestamp}`;
        
        runCommand(`git checkout -b ${branchName}`);

        // כאן השדרוג: ביקשתי מקלוד ליצור קובץ summary.txt עם הסבר על מה הוא עשה
        const claudePrompt = `"Read tasks/${taskFile}. Implement the requirements. After finishing, create a file named 'summary.txt' with a 2-sentence summary of your changes in HEBREW. Do not ask questions. Exit when done."`;
        
        const success = runCommand(`npx claude -p ${claudePrompt} --dangerously-skip-permissions`);

        if (success) {
            const status = execSync('git status --porcelain', { encoding: 'utf-8' });
            if (status.trim().length > 0) {
                // קריאת הסיכום שקלוד כתב
                let taskSummary = "לא סופק סיכום.";
                if (fs.existsSync('summary.txt')) {
                    taskSummary = fs.readFileSync('summary.txt', 'utf-8');
                    fs.unlinkSync('summary.txt'); // מחיקת הקובץ הזמני
                }

                runCommand('git add .');
                runCommand(`git commit -m "Auto-commit: ${taskFile}"`);
                runCommand(`git push -u origin ${branchName}`);

                const oldPath = path.join(TASKS_DIR, taskFile);
                const newPath = path.join(COMPLETED_DIR, taskFile);
                fs.renameSync(oldPath, newPath);

                finalReport += `📄 *משימה:* ${taskFile}\n`;
                finalReport += `💡 *מה בוצע:* ${taskSummary}\n`;
                finalReport += `🔗 *בראנץ':* \`${branchName}\`\n\n`;
            }
        }
        runCommand('git checkout main');
    }

    await sendTelegram(finalReport);
}

cron.schedule('0 8 * * *', () => executeTasksBatch());
executeTasksBatch(); // הרצה לבדיקה