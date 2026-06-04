const { spawn } = require('child_process');
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

let isRunning = false;
let lastReport = '';

// ================================================

async function sendTelegram(message) {
  try {
    const safe = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: safe,
      parse_mode: 'HTML'
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

        if (text === '/status') {
          const pendingCount = fs.existsSync(TASKS_DIR)
            ? fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, f)).isDirectory()).length
            : 0;
          const failedCount = fs.existsSync(FAILED_DIR)
            ? fs.readdirSync(FAILED_DIR).filter(f => f.endsWith('.md')).length
            : 0;
          const statusMsg =
            `<b>סטטוס סוכן קלוד</b>\n\n` +
            `${isRunning ? '🟢 כרגע רץ' : '😴 לא רץ'}\n` +
            `📋 משימות ממתינות: ${pendingCount}\n` +
            `🔁 ממתינות לretry: ${failedCount}\n\n` +
            (lastReport ? `<b>דיווח אחרון:</b>\n${lastReport.substring(0, 500)}` : 'אין דיווח עדיין');
          await sendTelegram(statusMsg);

        } else if (text === '/tasks') {
          const pendingTasks = fs.existsSync(TASKS_DIR)
            ? fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.md') && !fs.statSync(path.join(TASKS_DIR, f)).isDirectory())
            : [];
          const failedTasks = fs.existsSync(FAILED_DIR)
            ? fs.readdirSync(FAILED_DIR).filter(f => f.endsWith('.md'))
            : [];
          let taskMsg = `📋 <b>משימות ממתינות:</b>\n`;
          if (pendingTasks.length === 0) taskMsg += 'אין\n';
          else pendingTasks.forEach(f => { taskMsg += `• ${f}\n`; });
          taskMsg += `\n🔁 <b>ממתינות לretry:</b>\n`;
          if (failedTasks.length === 0) taskMsg += 'אין';
          else failedTasks.forEach(f => { taskMsg += `• ${f}\n`; });
          await sendTelegram(taskMsg);

        } else if (text === '/run') {
          if (isRunning) {
            await sendTelegram('⚠️ כבר רץ');
          } else {
            await sendTelegram('🚀 מריץ עכשיו...');
            executeTasksBatch().catch(err => console.error('CRITICAL ERROR:', err));
          }

        } else if (text === '/refresh') {
          waitingForCredentials = true;
          await sendTelegram(
            '🔑 <b>רענון טוקן</b>\n\nשלח את תוכן הקובץ <code>.credentials.json</code> שלך:'
          );

        } else if (waitingForCredentials && text.startsWith('{')) {
          waitingForCredentials = false;

          try {
            // וודא שזה JSON תקין
            const creds = JSON.parse(text);
            if (!creds.claudeAiOauth?.accessToken) throw new Error('Invalid format');

            // עדכן את ה-Secret File ב-Render
            await updateRenderSecret(text);
            await sendTelegram('✅ <b>טוקן עודכן בהצלחה!</b>\nהשירות יעלה מחדש תוך כדקה.');

          } catch (e) {
            await sendTelegram(`❌ <b>שגיאה:</b> ${e.message}\nוודא שהפורמט נכון.`);
          }

        } else {
          // Task injection
          const taskMatch = text.match(/^(pali|stockbot|diamonds):\s*(.+)$/is);
          if (taskMatch) {
            const slug = taskMatch[1].toLowerCase();
            const description = taskMatch[2].trim();
            const timestamp = Date.now();
            const filename = `${slug}-telegram-${timestamp}.md`;
            const filePath = path.join(TASKS_DIR, filename);

            const content = `Task: ${description}

## 🔨 Implementation
${description}

## ✅ Review Criteria
- המשימה מומשה במלואה
- הקוד תואם לסגנון הקיים
- אין console.log מיותרים
- אין שגיאות TypeScript
`;
            fs.writeFileSync(filePath, content);

            // Commit and push to agent repo
            await runCommand('git checkout main', __dirname);
            await runCommand('git pull origin main', __dirname);
            await runCommand('git add .', __dirname);
            await runCommand(`git commit -m "Task: ${filename}"`, __dirname);
            await runCommand(`git push ${getAuthUrl(AGENT_REPO)} main`, __dirname);

            await sendTelegram(`✅ <b>משימה נוצרה:</b> <code>${filename}</code>\nתרוץ בציקל הבא או שלח /run`);
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
  return new Promise((resolve) => {
    console.log(`\n[🏃 ${cwd ? path.basename(cwd) : ''}]: ${command}`);
    const child = spawn(command, [], {
      stdio: 'inherit',
      cwd,
      shell: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', (err) => {
      console.error(`\n[❌ Failed]: ${err.message}`);
      resolve(false);
    });
  });
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

  const success = await runCommand(
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

CRITICAL: Write tasks/review/review-result.md starting with EXACTLY this line (copy-paste, no changes):
## Status: ✅ PASSED
or
## Status: 🔧 FIXED
or
## Status: ❌ FAILED

The line must start with "## Status:" — not "Result:", not "Verdict:", not "PASS", not "APPROVED".
If the file does not start with "## Status:" the pipeline will break.
`.trim();

  const success = await runCommand(
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
  isRunning = true;
  try {
  // Setup git identity
  await runCommand('git config --global user.email "claude-bot@automation.local"', __dirname);
  await runCommand('git config --global user.name "Claude Agent"', __dirname);

  // Pull latest tasks
  console.log('\n[🔄] Pulling latest tasks from GitHub...');
  await runCommand(`git remote set-url origin ${getAuthUrl(AGENT_REPO)} 2>/dev/null || git remote add origin ${getAuthUrl(AGENT_REPO)}`, __dirname);
  await runCommand('git pull origin main', __dirname);

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
  let finalReport = `🤖 <b>דיווח סוכן קלוד</b>\n\n`;
  for (const task of pendingTasks.slice(0, 2)) {
    const { file: taskFile, dir: taskDir, isRetry } = task;
    const project = getProjectFromFilename(taskFile);

    if (!project) {
      finalReport += `⚠️ <b>דילוג:</b> ${taskFile} — לא נמצא פרויקט\n\n`;
      continue;
    }

    const { slug, repoUrl } = project;
    const repoDir = path.join(WORK_DIR, `${slug}-${Date.now()}`);
    const taskName = getTaskName(taskFile);

    console.log(`\n📦 Cloning ${slug}... ${isRetry ? '🔁 (retry)' : ''}`);
    if (!await runCommand(`git clone ${repoUrl} ${repoDir}`, WORK_DIR)) {
      finalReport += `❌ <b>Clone נכשל:</b> ${slug}\n\n`;
      continue;
    }

    await runCommand(`git config user.email "claude-bot@automation.local"`, repoDir);
    await runCommand(`git config user.name "Claude Agent"`, repoDir);

    // Copy task into repo
    const repoTasksDir = path.join(repoDir, 'tasks');
    if (!fs.existsSync(repoTasksDir)) fs.mkdirSync(repoTasksDir, { recursive: true });
    fs.copyFileSync(path.join(taskDir, taskFile), path.join(repoTasksDir, taskFile));

    // Create feature branch
    const branchName = `feature/${isRetry ? 'retry' : 'auto'}-${taskName}-${Date.now()}`;
    await runCommand(`git checkout -b ${branchName}`, repoDir);

    // ── AGENT 1: DEVELOPER ──
    console.log(`\n🔨 [DEVELOPER] ${isRetry ? 'Retrying' : 'Starting'} task: ${taskFile}`);
    const { success: devSuccess, reviewFile } = await runDeveloperAgent(repoDir, taskFile);

    if (!devSuccess) {
      finalReport += `❌ <b>Developer נכשל:</b> ${taskFile} (${slug})\n\n`;
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
    await runCommand('git add .', repoDir);
    await runCommand(`git commit -m "Dev: ${taskFile}"`, repoDir);

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
        await runCommand('git add .', repoDir);
        await runCommand(`git commit -m "Review passed: ${taskFile}"`, repoDir);
        break;
      } else if (fixed) {
        reviewStatus = `🔧 תוקן באיטרציה ${i}`;
        await runCommand('git add .', repoDir);
        await runCommand(`git commit -m "Review fix ${i}: ${taskFile}"`, repoDir);
        if (i === MAX_REVIEW_ITERATIONS) break;
      } else if (failed) {
        reviewStatus = '❌ נכשל בדיקה';
        await runCommand('git add .', repoDir);
        await runCommand(`git commit -m "Review failed: ${taskFile}"`, repoDir);
        break;
      }
    }

    // Cleanup task file from repo
    if (fs.existsSync(path.join(repoTasksDir, taskFile))) {
      fs.unlinkSync(path.join(repoTasksDir, taskFile));
      await runCommand('git add .', repoDir);
      await runCommand(`git commit -m "Cleanup: ${taskFile}"`, repoDir);
    }

    // Push branch
    const pushed = await runCommand(`git push ${getAuthUrl(repoUrl)} ${branchName}`, repoDir);
    if (!reviewStatus) {
      reviewStatus = '⚠️ סטטוס לא זוהה — בדוק לוגים';
    }
    if (pushed) {
      const isSuccess = reviewStatus.includes('✅') || reviewStatus.includes('🔧');
      const destDir = isSuccess ? COMPLETED_DIR : FAILED_DIR;
      finalReport += `${isRetry ? '🔁 <b>ריטריי</b>\n' : ''}`;
      finalReport += `📁 <b>פרויקט:</b> ${slug}\n`;
      finalReport += `📄 <b>משימה:</b> ${taskName}\n`;
      finalReport += `🌿 <b>ברנץ':</b> <code>${branchName}</code>\n`;
      finalReport += `💡 <b>פיתוח:</b> ${summary}\n`;
      finalReport += `🔍 <b>בדיקה:</b> ${reviewStatus}\n`;
      finalReport += `🔄 <b>איטרציות:</b> ${iterationCount}/${MAX_REVIEW_ITERATIONS}\n`;
      if (reviewNotes) {
        const issuesMatch = reviewNotes.match(/## Issues found:([\s\S]*?)(?=##|$)/);
        if (issuesMatch) finalReport += `⚠️ <b>בעיות שנמצאו:</b>\n${issuesMatch[1].trim()}\n`;

        const fixesMatch = reviewNotes.match(/## Fixes applied:([\s\S]*?)(?=##|$)/);
        if (fixesMatch) finalReport += `🔧 <b>תיקונים שבוצעו:</b>\n${fixesMatch[1].trim()}\n`;

        const notesMatch = reviewNotes.match(/## Notes:([\s\S]*?)(?=##|$)/);
        if (notesMatch) finalReport += `📝 <b>הערות:</b>\n${notesMatch[1].trim()}\n`;
      }
      // Move task — remove from old location first
      if (fs.existsSync(path.join(taskDir, taskFile))) {
        const destPath = path.join(destDir, taskFile);
        fs.renameSync(path.join(taskDir, taskFile), destPath);
        if (!isSuccess && reviewNotes) {
          const failureNotes = `\n\n---\n## ❌ סיבת הכישלון (נוספה אוטומטית)\n${reviewNotes}`;
          fs.appendFileSync(destPath, failureNotes);
        }
      }

      // Update agent repo
      await runCommand('git checkout main', __dirname);
      await runCommand('git pull origin main', __dirname);
      await runCommand('git add .', __dirname);
      const committed = await runCommand(`git commit -m "${isSuccess ? 'Done' : 'Failed'}: ${taskFile}${isRetry ? ' (retry)' : ''}"`, __dirname);
      if (committed) {
        await runCommand(`git push ${getAuthUrl(AGENT_REPO)} main`, __dirname);
      }

    } else {
      finalReport += `⚠️ <b>Push נכשל:</b> ${taskFile} (${slug})\n\n`;
    }

    // Cleanup workspace
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
  finalReport += '\n';
  if (finalReport.length > 4000) {
    finalReport = finalReport.substring(0, 3900) + '\n\n...✂️ נחתך';
  }
  lastReport = finalReport;
  await sendTelegram(finalReport);
  console.log('🏁 Batch finished.');
  } finally {
    isRunning = false;
  }
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
