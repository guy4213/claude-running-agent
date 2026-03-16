const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const http = require('http');

// ================================================
// 🟢 Keep-alive server for Render
// ================================================
http.createServer((req, res) => res.end('OK')).listen(process.env.PORT || 3000, () => {
  console.log(`🟢 Server listening on port ${process.env.PORT || 3000}`);
});

// ================================================
// 🔐 CREDENTIALS
// ================================================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8651652432:AAFfuiITIdBHXrSgO9ubASezP5Ms6S1jqxw';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5657105510';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const AGENT_REPO = 'https://github.com/guy4213/claude-running-agent';

if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN חסר!');
  process.exit(1);
}

// ================================================
// 🗺️ PROJECT MAP
// ================================================
const PROJECTS = {
  'pali':     'https://github.com/guy4213/pali-shop',
  'stockbot': 'https://github.com/guy4213/stockBot',
  'diamonds': 'https://github.com/guy4213/gem-exchange-lab',
};

const TASKS_DIR = path.join(__dirname, 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');
const FAILED_DIR = path.join(TASKS_DIR, 'failed');
const WORK_DIR = path.join(__dirname, 'workspace');
const MAX_REVIEW_ITERATIONS = 2;

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
  return repoUrl.replace('https://', `https://${GITHUB_TOKEN}@`);
}

function getProjectFromFilename(filename) {
  const prefix = filename.split('-')[0].toLowerCase();
  return PROJECTS[prefix] ? { slug: prefix, repoUrl: PROJECTS[prefix] } : null;
}

function getTaskName(taskFile) {
  // "pali-add-wallet.md" → "add-wallet"
  return taskFile.replace(/^[^-]+-/, '').replace('.md', '');
}

// ================================================
// 🔨 AGENT 1 — DEVELOPER
// ================================================
async function runDeveloperAgent(repoDir, taskFile) {
  const taskName = getTaskName(taskFile);
const reviewFile = `tasks/review/review-${taskName}.md`;

  const prompt = `
You are a senior developer. Follow these steps exactly:

1. Read CONTEXT.md in the project root if it exists — understand the project stack and conventions.
2. Read tasks/${taskFile} — focus on the "Implementation" section only.
3. Implement the task fully. Match existing code style. No placeholders.
4. Create the directory "tasks/review/" if it doesn't exist, then create the file "${reviewFile}" with this exact structure:
## What I implemented
[1-2 sentences describing what you built]

## Files changed
[list every file you created or modified]

## How to verify
[copy the Review Criteria from the task file here, and add any implementation-specific notes that will help the reviewer]

5. Write summary.txt in the project root with 1 sentence in Hebrew about what you implemented.
6. Exit.
`.trim();

  const success = runCommand(
    `npx claude -p "${prompt}" --dangerously-skip-permissions`,
    repoDir
  );

  return { success, reviewFile };
}

// ================================================
// ✅ AGENT 2 — REVIEWER
// ================================================
async function runReviewerAgent(repoDir, taskFile, reviewFile, iteration) {
  const prompt = `
You are a senior code reviewer. This is review iteration ${iteration} of ${MAX_REVIEW_ITERATIONS}.

Follow these steps exactly:

1. Read CONTEXT.md in the project root if it exists.
2. Read tasks/${taskFile} — focus on the "Review Criteria" section.
3. Read ${reviewFile} — understand what the developer implemented and what files changed.
4. Review the changed files carefully against the criteria.
5. If everything passes:
   - Delete the file "${reviewFile}"
   - Write tasks/review/review-result.md with:
     ## Status: ✅ PASSED
     ## Notes: [what you verified]
   - Exit.
6. If there are issues (max ${MAX_REVIEW_ITERATIONS} iterations total):
   - Fix the issues directly in the code.
   - Update ${reviewFile} to reflect the fixes.
   - Write tasks/review/review-result.md with:
     ## Status: 🔧 FIXED
     ## Issues found: [list issues]
     ## Fixes applied: [list fixes]
   - Exit.
7. If this is iteration ${MAX_REVIEW_ITERATIONS} and issues remain:
   - Write tasks/review/review-result.md with:
     ## Status: ❌ FAILED
     ## Issues: [list unresolved issues]
   - Exit.
`.trim();

  const success = runCommand(
    `npx claude -p "${prompt}" --dangerously-skip-permissions`,
    repoDir
  );

  // Read review result from tasks/review/
  const resultPath = path.join(repoDir, 'tasks', 'review', 'review-result.md');
  let resultContent = '';
  if (fs.existsSync(resultPath)) {
    resultContent = fs.readFileSync(resultPath, 'utf-8');
    fs.unlinkSync(resultPath);
  }

  const passed = resultContent.includes('✅ PASSED');
  const fixed = resultContent.includes('🔧 FIXED');
  const failed = resultContent.includes('❌ FAILED');

  return { success, passed, fixed, failed, resultContent };
}

// ================================================
// 🚀 MAIN TASK RUNNER
// ================================================
async function executeTasksBatch() {
  // Setup git identity
  runCommand('git config --global user.email "claude-bot@automation.local"', __dirname);
  runCommand('git config --global user.name "Claude Agent"', __dirname);

  // Pull latest tasks
  console.log('\n[🔄] Pulling latest tasks from GitHub...');
  runCommand(`git remote set-url origin ${getAuthUrl(AGENT_REPO)} 2>/dev/null || git remote add origin ${getAuthUrl(AGENT_REPO)}`, __dirname);
  runCommand('git pull origin main', __dirname);

  console.log('\n[!] Scanning for tasks...');

  ['completed', 'failed'].forEach(dir => {
    const p = path.join(TASKS_DIR, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const pendingTasks = fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, f)).isDirectory());

  if (pendingTasks.length === 0) {
    console.log('😴 No tasks found.');
    return;
  }

  console.log(`✅ Found ${pendingTasks.length} tasks!`);
  let finalReport = `🤖 *דיווח סוכן קלוד*\n\n`;

  for (const taskFile of pendingTasks.slice(0, 2)) {
    const project = getProjectFromFilename(taskFile);

    if (!project) {
      finalReport += `⚠️ *דילוג:* ${taskFile} — לא נמצא פרויקט\n\n`;
      continue;
    }

    const { slug, repoUrl } = project;
    const repoDir = path.join(WORK_DIR, `${slug}-${Date.now()}`);
    const taskName = getTaskName(taskFile);

    console.log(`\n📦 Cloning ${slug}...`);
    if (!runCommand(`git clone ${repoUrl} ${repoDir}`, WORK_DIR)) {
      finalReport += `❌ *Clone נכשל:* ${slug}\n\n`;
      continue;
    }

    runCommand(`git config user.email "claude-bot@automation.local"`, repoDir);
    runCommand(`git config user.name "Claude Agent"`, repoDir);

    // Copy task into repo
    const repoTasksDir = path.join(repoDir, 'tasks');
    if (!fs.existsSync(repoTasksDir)) fs.mkdirSync(repoTasksDir, { recursive: true });
    fs.copyFileSync(path.join(TASKS_DIR, taskFile), path.join(repoTasksDir, taskFile));

    // Create feature branch
    const branchName = `feature/auto-${taskName}-${Date.now()}`;
    runCommand(`git checkout -b ${branchName}`, repoDir);

    // ── AGENT 1: DEVELOPER ──
    console.log(`\n🔨 [DEVELOPER] Starting task: ${taskFile}`);
    const { success: devSuccess, reviewFile } = await runDeveloperAgent(repoDir, taskFile);

    if (!devSuccess) {
      finalReport += `❌ *Developer נכשל:* ${taskFile} (${slug})\n\n`;
      fs.rmSync(repoDir, { recursive: true, force: true });
      continue;
    }

    // Read summary
    let summary = "בוצעו שינויים בקוד.";
    const summaryPath = path.join(repoDir, 'summary.txt');
    if (fs.existsSync(summaryPath)) {
      summary = fs.readFileSync(summaryPath, 'utf-8').trim();
      fs.unlinkSync(summaryPath);
    }

    // Commit developer work
    runCommand('git add .', repoDir);
    runCommand(`git commit -m "Dev: ${taskFile}"`, repoDir);

    // ── AGENT 2: REVIEWER ──
    let reviewStatus = '';
    let reviewNotes = '';

    for (let i = 1; i <= MAX_REVIEW_ITERATIONS; i++) {
      console.log(`\n✅ [REVIEWER] Iteration ${i}/${MAX_REVIEW_ITERATIONS}`);
      const { passed, fixed, failed, resultContent } = await runReviewerAgent(repoDir, taskFile, reviewFile, i);

      reviewNotes = resultContent;

      if (passed) {
        reviewStatus = '✅ עבר בדיקה';
        runCommand('git add .', repoDir);
        runCommand(`git commit -m "Review passed: ${taskFile}"`, repoDir);
        break;
      } else if (fixed) {
        reviewStatus = `🔧 תוקן באיטרציה ${i}`;
        runCommand('git add .', repoDir);
        runCommand(`git commit -m "Review fix ${i}: ${taskFile}"`, repoDir);
        if (i === MAX_REVIEW_ITERATIONS) break;
      } else if (failed) {
        reviewStatus = '❌ נכשל בדיקה';
        runCommand('git add .', repoDir);
        runCommand(`git commit -m "Review failed: ${taskFile}"`, repoDir);
        break;
      }
    }

    if (fs.existsSync(path.join(repoTasksDir, taskFile))) {
        fs.unlinkSync(path.join(repoTasksDir, taskFile));
        runCommand('git add .', repoDir);
        runCommand(`git commit -m "Cleanup: ${taskFile}"`, repoDir);
      }
          // Push branch
    const pushed = runCommand(`git push ${getAuthUrl(repoUrl)} ${branchName}`, repoDir);

    if (pushed) {
      const isSuccess = reviewStatus.includes('✅') || reviewStatus.includes('🔧');

      // Move task to correct folder
      const destDir = isSuccess ? COMPLETED_DIR : FAILED_DIR;
      fs.renameSync(path.join(TASKS_DIR, taskFile), path.join(destDir, taskFile));

      // Update agent repo
      runCommand('git checkout main', __dirname);
      runCommand('git pull origin main', __dirname);
      runCommand('git add .', __dirname);
      runCommand(`git commit -m "${isSuccess ? 'Done' : 'Failed'}: ${taskFile}"`, __dirname);
      runCommand(`git push ${getAuthUrl(AGENT_REPO)} main`, __dirname);

      finalReport += `📁 *פרויקט:* ${slug}\n`;
      finalReport += `📄 *משימה:* ${taskName}\n`;
      finalReport += `🌿 *ברנץ':* \`${branchName}\`\n`;
      finalReport += `💡 *פיתוח:* ${summary}\n`;
      finalReport += `🔍 *בדיקה:* ${reviewStatus}\n\n`;
    } else {
      finalReport += `⚠️ *Push נכשל:* ${taskFile} (${slug})\n\n`;
    }

    // Cleanup
    fs.rmSync(repoDir, { recursive: true, force: true });
  }

  await sendTelegram(finalReport);
  console.log('🏁 Batch finished.');
}

// ================================================
// ⏰ CRON
// ================================================
cron.schedule('0 8 * * *', () => executeTasksBatch());

console.log('🤖 Claude Multi-Agent is UP and RUNNING!');
console.log('🕒 Cron: 08:00 daily');
console.log('📂 Projects:', Object.keys(PROJECTS).join(', '));

executeTasksBatch().catch(err => console.error('CRITICAL ERROR:', err));