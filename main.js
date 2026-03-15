const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const TASKS_DIR = path.join(__dirname, 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');
const MAX_TASKS_PER_RUN = 2;

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

function executeTasksBatch() {
    console.log('\n=== Waking up Claude for tasks ===');

    if (!fs.existsSync(COMPLETED_DIR)) {
        fs.mkdirSync(COMPLETED_DIR, { recursive: true });
    }

    const allFiles = fs.existsSync(TASKS_DIR) ? fs.readdirSync(TASKS_DIR) : [];
    const pendingTasks = allFiles.filter(file => file.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, file)).isDirectory());

    if (pendingTasks.length === 0) {
        console.log('No pending tasks found. Going back to sleep.');
        return;
    }

    const tasksToProcess = pendingTasks.slice(0, MAX_TASKS_PER_RUN);
    console.log(`Found ${pendingTasks.length} tasks. Processing ${tasksToProcess.length} tasks now...`);

    // משיכת הקוד העדכני כדי למנוע קונפליקטים
    runCommand('git checkout main');
    runCommand('git pull origin main');

    for (const taskFile of tasksToProcess) {
        console.log(`\n>>> Executing Task: ${taskFile} <<<`);
        const branchName = `feature/auto-${taskFile.replace('.md', '')}`;

        runCommand(`git checkout -b ${branchName}`);

        // הרצת קלוד קוד בטרמינל
        const claudePrompt = `"Read tasks/${taskFile}. Implement the requirements in the codebase. Do not ask for any user input or confirmation. When you are done, just exit."`;
        const isSuccess = runCommand(`npx claude -p ${claudePrompt} --dangerously-skip-permissions`);
        if (isSuccess) {
            const status = execSync('git status --porcelain', { encoding: 'utf-8' });
            if (status.trim().length > 0) {
                console.log('\nChanges detected! Committing and pushing...');
                runCommand('git add .');
                runCommand(`git commit -m "Auto-commit: Implemented ${taskFile} via Claude"`);
                runCommand(`git push -u origin ${branchName}`);
                
                fs.renameSync(path.join(TASKS_DIR, taskFile), path.join(COMPLETED_DIR, taskFile));
                console.log(`\n✅ Success! Branch ${branchName} is ready on GitHub.`);
            } else {
                console.log(`\n⚠️ Claude finished, but made no code changes for ${taskFile}.`);
            }
        } else {
            console.log(`\n❌ Claude encountered an error on ${taskFile}.`);
        }

        // חזרה לראשי
        runCommand('git checkout main');
    }

    console.log('\n=== Batch execution finished ===\n');
}

// התזמון הקבוע ל-08:00 בבוקר
cron.schedule('0 8 * * *', () => {
    executeTasksBatch();
});

console.log('🤖 Claude Automation Manager started.');

// --- טריק לבדיקה מקומית מיידית ---
// מפעיל את הפונקציה פעם אחת עכשיו כדי שנראה שזה עובד, ואז ממשיך להאזין
console.log('Running initial test execution now...');
executeTasksBatch();