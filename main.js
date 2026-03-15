const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios'); // <--- תוסיף את זה!
// הגדרות נתיבים - מותאם לווינדוס
const TASKS_DIR = path.join(__dirname, 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');
const MAX_TASKS_PER_RUN = 2;
// לוג בדיקה ראשוני - חייב להופיע בטרמינל מיד!
console.log('--- SCRIPT STARTING ---');

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
        console.error(`\n[❌ Failed]: ${error.message}`);
        return false;
    }
}

async function executeTasksBatch() {
    console.log('\n[!] Scanning for tasks...');
    
    if (!fs.existsSync(COMPLETED_DIR)) fs.mkdirSync(COMPLETED_DIR, { recursive: true });
    if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });

    const allFiles = fs.readdirSync(TASKS_DIR);
    const pendingTasks = allFiles.filter(file => file.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, file)).isDirectory());

    if (pendingTasks.length === 0) {
        console.log('😴 No tasks found in /tasks folder.');
        return;
    }

    console.log(`✅ Found ${pendingTasks.length} tasks! Starting...`);

    runCommand('git checkout main');
    
    let finalReport = `🤖 *דיווח בוקר מפורט - סוכן קלוד*\n\n`;

    for (const taskFile of pendingTasks.slice(0, 2)) {
        const branchName = `feature/auto-${Date.now()}`;
        runCommand(`git checkout -b ${branchName}`);

        const prompt = `"Read tasks/${taskFile}. Implement it. Create 'summary.txt' with 1 sentence in Hebrew about what you did. Exit."`;
        const success = runCommand(`npx claude -p ${prompt} --dangerously-skip-permissions`);

        if (success) {
            let summary = "בוצעו שינויים בקוד.";
            if (fs.existsSync('summary.txt')) {
                summary = fs.readFileSync('summary.txt', 'utf-8');
                fs.unlinkSync('summary.txt');
            }
            
            runCommand('git add .');
            runCommand(`git commit -m "Auto: ${taskFile}"`);
            runCommand(`git push -u origin ${branchName}`);
            
            fs.renameSync(path.join(TASKS_DIR, taskFile), path.join(COMPLETED_DIR, taskFile));
            finalReport += `📄 *משימה:* ${taskFile}\n💡 *סיכום:* ${summary}\n\n`;
        }
        runCommand('git checkout main');
    }
    
    await sendTelegram(finalReport);
    console.log('🏁 Batch finished.');
}

// תזמון
cron.schedule('0 8 * * *', () => {
    executeTasksBatch();
});

// הודעת הפעלה
console.log('🤖 Claude Automation is UP and RUNNING!');
console.log('🕒 Cron scheduled for 08:00');

// הרצה מיידית
executeTasksBatch().catch(err => console.error('CRITICAL ERROR:', err));