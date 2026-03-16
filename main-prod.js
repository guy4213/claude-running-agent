const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();
// ================================================
// 🔐 CREDENTIALS — הגדר אלה ב-Render Environment Variables
// ================================================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8651652432:AAFfuiITIdBHXrSgO9ubASezP5Ms6S1jqxw';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5657105510';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // חובה ב-Render, ללא זה push נכשל

if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN חסר! הוסף אותו ב-Render → Environment Variables');
  process.exit(1);
}

// ================================================
// 🗺️  PROJECT MAP
// ================================================
const PROJECTS = {
  'pali':     'https://github.com/guy4213/pali-shop',
  'stockbot': 'https://github.com/guy4213/stockBot',
  'diamonds': 'https://github.com/guy4213/gem-exchange-lab',
};

// ================================================
// 📂 זה הריפו של הסוכן עצמו — לשאיבת משימות חדשות
// ================================================
const AGENT_REPO = 'https://github.com/guy4213/claude-running-agent'; // שנה לשם הריפו שלך
const TASKS_DIR = path.join(__dirname, 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');
const WORK_DIR = path.join(__dirname, 'workspace');

// ================================================

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

function runCommand(command, cwd) {
  try {
    console.log(`\n[🏃 ${cwd ? path.basename(cwd) : ''}]: ${command}`);
    execSync(command, { stdio: 'inherit', encoding: 'utf-8', cwd });
    return true;
  } catch (error) {
    console.error(`\n[❌ Failed]: ${error.message}`);
    return false;
  }
}

function getAuthUrl(repoUrl) {
  // מזריק את ה-token לתוך ה-URL לפוש
  return repoUrl.replace('https://', `https://${GITHUB_TOKEN}@`);
}

function getProjectFromFilename(filename) {
  const prefix = filename.split('-')[0].toLowerCase();
  return PROJECTS[prefix] ? { slug: prefix, repoUrl: PROJECTS[prefix] } : null;
}

async function pullLatestTasks() {
  console.log('\n[🔄] Pulling latest tasks from GitHub...');
  runCommand(`git remote add origin ${getAuthUrl(AGENT_REPO)}`, __dirname);
  runCommand('git pull origin main', __dirname);
}

async function executeTasksBatch() {
  // שלב 0 — משוך משימות חדשות מה-repo
  runCommand('git config --global user.email "claude-bot@automation.local"', __dirname);
  runCommand('git config --global user.name "Claude Agent"', __dirname);
  await pullLatestTasks();

  console.log('\n[!] Scanning for tasks...');

  if (!fs.existsSync(COMPLETED_DIR)) fs.mkdirSync(COMPLETED_DIR, { recursive: true });
  if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const pendingTasks = fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, f)).isDirectory());

  if (pendingTasks.length === 0) {
    console.log('😴 No tasks found.');
    return;
  }

  console.log(`✅ Found ${pendingTasks.length} tasks! Starting...`);
  let finalReport = `🤖 *דיווח מפורט - סוכן קלוד*\n\n`;

  for (const taskFile of pendingTasks.slice(0, 2)) {
    const project = getProjectFromFilename(taskFile);

    if (!project) {
      console.warn(`⚠️ Unknown prefix: ${taskFile} — skipping.`);
      finalReport += `⚠️ *דילוג:* ${taskFile} — לא נמצא פרויקט מתאים\n\n`;
      continue;
    }

    const { slug, repoUrl } = project;
    const repoDir = path.join(WORK_DIR, `${slug}-${Date.now()}`);

    // 1. Clone (פאבליק — לא צריך טוקן)
    console.log(`\n📦 Cloning ${slug}...`);
    const cloned = runCommand(`git clone ${repoUrl} ${repoDir}`, WORK_DIR);
    if (!cloned) {
      finalReport += `❌ *Clone נכשל:* ${slug}\n\n`;
      continue;
    }

    // 2. Git identity
    runCommand(`git config user.email "claude-bot@automation.local"`, repoDir);
    runCommand(`git config user.name "Claude Agent"`, repoDir);

    // 3. Copy task into repo
    const repoTasksDir = path.join(repoDir, 'tasks');
    if (!fs.existsSync(repoTasksDir)) fs.mkdirSync(repoTasksDir, { recursive: true });
    fs.copyFileSync(path.join(TASKS_DIR, taskFile), path.join(repoTasksDir, taskFile));

    // 4. Feature branch
    const branchName = `feature/auto-${Date.now()}`;
    runCommand(`git checkout -b ${branchName}`, repoDir);

    // 5. Run Claude
    const prompt = `"You are a project agent. First read CONTEXT.md in the project root if it exists. Then read tasks/${taskFile} and implement it fully. Write summary.txt in the project root with 1 sentence in Hebrew about what you did. Exit."`;
    const success = runCommand(
      `npx claude -p ${prompt} --dangerously-skip-permissions`,
      repoDir
    );

    if (success) {
      // 6. Read summary
      let summary = "בוצעו שינויים בקוד.";
      const summaryPath = path.join(repoDir, 'summary.txt');
      if (fs.existsSync(summaryPath)) {
        summary = fs.readFileSync(summaryPath, 'utf-8').trim();
        fs.unlinkSync(summaryPath);
      }

      // 7. Remove task file before committing
      fs.unlinkSync(path.join(repoTasksDir, taskFile));

      // 8. Commit + push עם GitHub token
      
      runCommand('git add .', repoDir);
      runCommand(`git commit -m "Auto: ${taskFile}"`, repoDir);
      const pushed = runCommand(
        `git push ${getAuthUrl(repoUrl)} ${branchName}`,
        repoDir
      );

        if (pushed) {
        fs.renameSync(
          path.join(TASKS_DIR, taskFile),
          path.join(COMPLETED_DIR, taskFile)
        );

        runCommand('git checkout main', __dirname);
        runCommand('git config user.email "claude-bot@automation.local"', __dirname);
        runCommand('git config user.name "Claude Agent"', __dirname);
        runCommand('git pull origin main', __dirname);
        runCommand('git add .', __dirname);
        runCommand(`git commit -m "Done: ${taskFile}"`, __dirname);
        runCommand(`git push ${getAuthUrl(AGENT_REPO)} main`, __dirname);

        finalReport += `📁 *פרויקט:* ${slug}\n📄 *משימה:* ${taskFile}\n🌿 *ברנץ':* \`${branchName}\`\n💡 *סיכום:* ${summary}\n\n`;
      } else {
        finalReport += `⚠️ *Push נכשל:* ${taskFile} (${slug})\n\n`;
      }
    } else {
      finalReport += `❌ *Claude נכשל:* ${taskFile} (${slug})\n\n`;
    }

    // 10. Cleanup
    console.log(`\n🧹 Cleaning up workspace...`);
    fs.rmSync(repoDir, { recursive: true, force: true });
  }

  await sendTelegram(finalReport);
  console.log('🏁 Batch finished.');
}

cron.schedule('0 8 * * *', () => {
  executeTasksBatch();
});

console.log('🤖 Claude Automation is UP and RUNNING on Render!');
console.log('🕒 Cron scheduled for 08:00');
console.log('📂 Projects:', Object.keys(PROJECTS).join(', '));

executeTasksBatch().catch(err => console.error('CRITICAL ERROR:', err));
//