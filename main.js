const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// הגדרות נתיבים - מותאם לווינדוס
const TASKS_DIR = path.join(__dirname, 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');
const MAX_TASKS_PER_RUN = 2;

/**
 * פונקציית עזר להרצת פקודות טרמינל עם לוגים מסודרים
 */
function runCommand(command) {
    try {
        console.log(`\n[🏃 Running]: ${command}`);
        // נשתמש ב-stdio: 'inherit' כדי לראות את הפלט של קלוד וגיט בלייב
        execSync(command, { stdio: 'inherit', encoding: 'utf-8' });
        return true;
    } catch (error) {
        console.error(`\n[❌ Failed]: ${command}`);
        return false;
    }
}

/**
 * פונקציית הליבה של האוטומציה
 */
function executeTasksBatch() {
    console.log('\n==========================================');
    console.log('🤖 Starting Claude Automation Batch');
    console.log(`⏰ Time: ${new Date().toLocaleString()}`);
    console.log('==========================================');

    // יצירת תיקיית completed אם היא לא קיימת
    if (!fs.existsSync(COMPLETED_DIR)) {
        fs.mkdirSync(COMPLETED_DIR, { recursive: true });
    }

    // סריקת משימות פתוחות (רק קבצי Markdown בתיקייה הראשית של tasks)
    const allFiles = fs.existsSync(TASKS_DIR) ? fs.readdirSync(TASKS_DIR) : [];
    const pendingTasks = allFiles.filter(file => 
        file.endsWith('.md') && 
        !fs.statSync(path.join(TASKS_DIR, file)).isDirectory()
    );

    if (pendingTasks.length === 0) {
        console.log('📭 No pending tasks found. System idle.');
        return;
    }

    // הגבלת כמות המשימות לריצה אחת (למשל 2)
    const tasksToProcess = pendingTasks.slice(0, MAX_TASKS_PER_RUN);
    console.log(`📝 Found ${pendingTasks.length} tasks. Processing the next ${tasksToProcess.length}...`);

    // יישור קו מול השרת לפני תחילת עבודה
    runCommand('git checkout main');
    runCommand('git pull origin main');

    for (const taskFile of tasksToProcess) {
        console.log(`\n------------------------------------------`);
        console.log(`🚀 PROCESSING TASK: ${taskFile}`);
        
        // יצירת שם בראנץ' ייחודי עם חותמת זמן למניעת התנגשויות
        const timestamp = Date.now();
        const branchName = `feature/auto-${taskFile.replace('.md', '')}-${timestamp}`;

        // יצירת הענף החדש
        const checkoutSuccess = runCommand(`git checkout -b ${branchName}`);
        if (!checkoutSuccess) continue;

        // הפעלת קלוד - עם npx לעקיפת בעיות PATH ודגל הרשאות אוטומטי
        const claudePrompt = `"Read tasks/${taskFile}. Implement the requirements in the codebase. Do not ask for any user input or confirmation. When you are done, just exit."`;
        const isClaudeSuccess = runCommand(`npx claude -p ${claudePrompt} --dangerously-skip-permissions`);

        if (isClaudeSuccess) {
            // בדיקה אם נוצרו שינויים פיזיים בקוד
            const status = execSync('git status --porcelain', { encoding: 'utf-8' });
            
            if (status.trim().length > 0) {
                console.log('\n✨ Changes detected! Committing and pushing...');
                runCommand('git add .');
                runCommand(`git commit -m "Auto-commit: Implemented ${taskFile} via Claude"`);
                runCommand(`git push -u origin ${branchName}`);
                
                // העברת המשימה ל-completed מיד לאחר הפוש (לפני החלפת בראנץ')
                const oldPath = path.join(TASKS_DIR, taskFile);
                const newPath = path.join(COMPLETED_DIR, taskFile);
                
                if (fs.existsSync(oldPath)) {
                    fs.renameSync(oldPath, newPath);
                    console.log(`\n✅ Task ${taskFile} archived to completed/`);
                }
                
                console.log(`\n🎉 Success! Pull Request ready for: ${branchName}`);
            } else {
                console.log(`\n⚠️ Claude finished, but no files were modified for ${taskFile}.`);
            }
        } else {
            console.log(`\n❌ Claude failed to complete the task: ${taskFile}`);
        }

        // חזרה ל-main לקראת המשימה הבאה
        runCommand('git checkout main');
    }

    console.log('\n==========================================');
    console.log('🏁 Batch execution finished. Waiting for next cron...');
    console.log('==========================================\n');
}

// --- הגדרת תזמון (Cron) ---
// רץ בכל יום ב-08:00 בבוקר
cron.schedule('0 8 * * *', () => {
    executeTasksBatch();
});

console.log('🤖 Claude Automation Manager is active.');
console.log('📅 Schedule: Every day at 08:00 AM.');
console.log('💡 Note: You can also run it immediately for testing.');

// --- הרצה ראשונית לבדיקה (אופציונלי - אפשר למחוק אם רוצים רק קרון) ---
executeTasksBatch();