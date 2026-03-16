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

// ================================================
// 🔑 TOKEN REFRESH
// ================================================
async function refreshClaudeToken() {
  console.log('\n[🔑] Refreshing Claude token...');
  const result = runCommand('npx claude --version', __dirname);
  if (result) {
    // וודא שה-credentials מועתקים נכון ל-HOME
    runCommand(`cp /etc/secrets/credentials.json $HOME/.claude/.credentials.json`, __dirname);
    console.log('✅ Claude token ready');
  } else {
    await sendTelegram('⚠️ *שגיאה:* Claude token פג תוקף');
  }
  return result;
}
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
// ================================================
// 🔄 TELEGRAM REFRESH COMMAND
// ================================================
let waitingForCredentials = false;

async function handleTelegramUpdates() {
  let offset = 0;

  setInterval(async () => {
    try {
      const res = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=5`
      );

      for (const update of res.data.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg) continue;

        const text = msg.text || '';
        const chatId = msg.chat.id.toString();

        // רק מה-chat שלך
        if (chatId !== TELEGRAM_CHAT_ID) continue;

        if (text === '/refresh') {
          waitingForCredentials = true;
          await sendTelegram(
            '🔑 *רענון טוקן*\n\nשלח את תוכן הקובץ `.credentials.json` שלך:'
          );

        } else if (waitingForCredentials && text.startsWith('{')) {
          waitingForCredentials = false;

          try {
            // וודא שזה JSON תקין
            const creds = JSON.parse(text);
            if (!creds.claudeAiOauth?.accessToken) throw new Error('Invalid format');

            // עדכן את ה-Secret File ב-Render
            await updateRenderSecret(text);
            await sendTelegram('✅ *טוקן עודכן בהצלחה!*\nהשירות יעלה מחדש תוך כדקה.');

          } catch (e) {
            await sendTelegram(`❌ *שגיאה:* ${e.message}\nוודא שהפורמט נכון.`);
          }
        }
      }
    } catch (e) {
      // שקט בשגיאות polling
    }
  }, 3000);
}

async function updateRenderSecret(newCredentials) {
  const RENDER_API_KEY = process.env.RENDER_API_KEY;
  const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;

  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) {
    throw new Error('RENDER_API_KEY או RENDER_SERVICE_ID חסרים');
  }

  // שלב 1 — מצא את ה-secret file הקיים
  const filesRes = await axios.get(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/secret-files`,
    { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } }
  );

  const secretFile = filesRes.data.find(f => f.name === 'credentials.json');
  if (!secretFile) throw new Error('credentials.json לא נמצא ב-Render');

  // שלב 2 — עדכן את התוכן
  await axios.put(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/secret-files/${secretFile.id}`,
    { content: newCredentials },
    { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } }
  );

  // שלב 3 — Redeploy
  await axios.post(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`,
    {},
    { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } }
  );
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
4. Review the changed files carefully against every criterion.

${iteration < MAX_REVIEW_ITERATIONS ? `
5. If everything passes:
   - Delete the file "${reviewFile}"
   - Write tasks/review/review-result.md with:
     ## Status: ✅ PASSED
     ## Notes: [what you verified]
   - Exit.

6. If there are issues:
   - Fix ALL issues directly in the code. Do not skip any.
   - Update ${reviewFile} to describe what you fixed.
   - Write tasks/review/review-result.md with:
     ## Status: 🔧 FIXED
     ## Issues found: [list every issue]
     ## Fixes applied: [list every fix]
   - Exit.
` : `
5. If everything passes:
   - Delete the file "${reviewFile}"
   - Write tasks/review/review-result.md with:
     ## Status: ✅ PASSED
     ## Notes: [what you verified]
   - Exit.

6. If ANY issues remain — even minor ones:
   - Do NOT attempt to fix. This is the final iteration.
   - Write tasks/review/review-result.md with:
     ## Status: ❌ FAILED
     ## Issues: [list every unresolved issue]
   - Exit.
`}

CRITICAL OUTPUT RULE:
The first line of tasks/review/review-result.md MUST be exactly one of:
  ## Status: ✅ PASSED
  ## Status: 🔧 FIXED
  ## Status: ❌ FAILED

Do NOT use any other wording — no "APPROVED", "LGTM", "looks good", or any variation.
This exact format is required for the automation pipeline to work correctly.
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
    await refreshClaudeToken();

  // Setup git identity
  runCommand('git config --global user.email "claude-bot@automation.local"', __dirname);
  runCommand('git config --global user.name "Claude Agent"', __dirname);

  // Pull latest tasks
  console.log('\n[🔄] Pulling latest tasks from GitHub...');
  runCommand(`git remote set-url origin ${getAuthUrl(AGENT_REPO)} 2>/dev/null || git remote add origin ${getAuthUrl(AGENT_REPO)}`, __dirname);
  runCommand('git pull origin main', __dirname);

  console.log('\n[!] Scanning for tasks...');

  ['completed', 'failed', 'review'].forEach(dir => {
    const p = path.join(TASKS_DIR, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  // Failed tasks get priority
  const failedTasks = fs.readdirSync(FAILED_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ file: f, dir: FAILED_DIR, isRetry: true }));

  const newTasks = fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, f)).isDirectory())
    .map(f => ({ file: f, dir: TASKS_DIR, isRetry: false }));

  const pendingTasks = [...failedTasks, ...newTasks];

  if (pendingTasks.length === 0) {
    console.log('😴 No tasks found.');
    return;
  }

  console.log(`✅ Found ${pendingTasks.length} tasks! (${failedTasks.length} retries, ${newTasks.length} new)`);
  let finalReport = `🤖 *דיווח סוכן קלוד*\n\n`;
  for (const task of pendingTasks.slice(0, 2)) {
    const { file: taskFile, dir: taskDir, isRetry } = task;
    const project = getProjectFromFilename(taskFile);

    if (!project) {
      finalReport += `⚠️ *דילוג:* ${taskFile} — לא נמצא פרויקט\n\n`;
      continue;
    }

    const { slug, repoUrl } = project;
    const repoDir = path.join(WORK_DIR, `${slug}-${Date.now()}`);
    const taskName = getTaskName(taskFile);

    console.log(`\n📦 Cloning ${slug}... ${isRetry ? '🔁 (retry)' : ''}`);
    if (!runCommand(`git clone ${repoUrl} ${repoDir}`, WORK_DIR)) {
      finalReport += `❌ *Clone נכשל:* ${slug}\n\n`;
      continue;
    }

    runCommand(`git config user.email "claude-bot@automation.local"`, repoDir);
    runCommand(`git config user.name "Claude Agent"`, repoDir);

    // Copy task into repo
    const repoTasksDir = path.join(repoDir, 'tasks');
    if (!fs.existsSync(repoTasksDir)) fs.mkdirSync(repoTasksDir, { recursive: true });
    fs.copyFileSync(path.join(taskDir, taskFile), path.join(repoTasksDir, taskFile));

    // Create feature branch
    const branchName = `feature/${isRetry ? 'retry' : 'auto'}-${taskName}-${Date.now()}`;
    runCommand(`git checkout -b ${branchName}`, repoDir);

    // ── AGENT 1: DEVELOPER ──
    console.log(`\n🔨 [DEVELOPER] ${isRetry ? 'Retrying' : 'Starting'} task: ${taskFile}`);
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

    // Commit developer work (keep task file for reviewer)
    runCommand('git add .', repoDir);
    runCommand(`git commit -m "Dev: ${taskFile}"`, repoDir);

    // ── AGENT 2: REVIEWER ──
    let reviewStatus = '';
    let reviewNotes = '';
    let iterationCount = 0;
for (let i = 1; i <= MAX_REVIEW_ITERATIONS; i++) {
      console.log(`\n✅ [REVIEWER] Iteration ${i}/${MAX_REVIEW_ITERATIONS}`);
      const { passed, fixed, failed, resultContent } = await runReviewerAgent(repoDir, taskFile, reviewFile, i);

      iterationCount = i;
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

    // Cleanup task file from repo
    if (fs.existsSync(path.join(repoTasksDir, taskFile))) {
      fs.unlinkSync(path.join(repoTasksDir, taskFile));
      runCommand('git add .', repoDir);
      runCommand(`git commit -m "Cleanup: ${taskFile}"`, repoDir);
    }

    // Push branch
    const pushed = runCommand(`git push ${getAuthUrl(repoUrl)} ${branchName}`, repoDir);

    if (pushed) {
      const isSuccess = reviewStatus.includes('✅') || reviewStatus.includes('🔧');
      const destDir = isSuccess ? COMPLETED_DIR : FAILED_DIR;
       finalReport += `${isRetry ? '🔁 *ריטריי*\n' : ''}`;
    finalReport += `📁 *פרויקט:* ${slug}\n`;
    finalReport += `📄 *משימה:* ${taskName}\n`;
    finalReport += `🌿 *ברנץ':* \`${branchName}\`\n`;
    finalReport += `💡 *פיתוח:* ${summary}\n`;
    finalReport += `🔍 *בדיקה:* ${reviewStatus}\n`;
    finalReport += `🔄 *איטרציות:* ${iterationCount}/${MAX_REVIEW_ITERATIONS}\n`;
     if (reviewNotes) {
      const issuesMatch = reviewNotes.match(/## Issues found:([\s\S]*?)(?=##|$)/);
      if (issuesMatch) finalReport += `⚠️ *בעיות שנמצאו:*\n${issuesMatch[1].trim()}\n`;

      const fixesMatch = reviewNotes.match(/## Fixes applied:([\s\S]*?)(?=##|$)/);
      if (fixesMatch) finalReport += `🔧 *תיקונים שבוצעו:*\n${fixesMatch[1].trim()}\n`;

      const notesMatch = reviewNotes.match(/## Notes:([\s\S]*?)(?=##|$)/);
      if (notesMatch) finalReport += `📝 *הערות:*\n${notesMatch[1].trim()}\n`;
    }
      // Move task — remove from old location first
      if (fs.existsSync(path.join(taskDir, taskFile))) {
        fs.renameSync(path.join(taskDir, taskFile), path.join(destDir, taskFile));
      }

      // Update agent repo
      runCommand('git checkout main', __dirname);
      runCommand('git pull origin main', __dirname);
      runCommand('git add .', __dirname);
      const committed = runCommand(`git commit -m "${isSuccess ? 'Done' : 'Failed'}: ${taskFile}${isRetry ? ' (retry)' : ''}"`, __dirname);
      if (committed) {
      runCommand(`git push ${getAuthUrl(AGENT_REPO)} main`, __dirname);
       }

     
    } else {
      finalReport += `⚠️ *Push נכשל:* ${taskFile} (${slug})\n\n`;
    }

    // Cleanup workspace
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
    finalReport += '\n';
if (finalReport.length > 4000) {
  finalReport = finalReport.substring(0, 3900) + '\n\n...✂️ נחתך';
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
handleTelegramUpdates();
