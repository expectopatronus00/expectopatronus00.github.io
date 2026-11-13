#!/usr/bin/env node
/**
 * daily-run.cjs · 每日确定性收尾
 * -----------------------------------------
 * 只做「不需要判断」的那一段：一致性检查 → 重建索引 → 提交推送 → 发通知。
 * 采集、评分、写正文都不在这里（那些需要 agent 参与，见 skills/source-radar）。
 *
 * 用法：
 *   node scripts/daily-run.cjs                # 检查 + 重建 + 提交推送 + 通知
 *   node scripts/daily-run.cjs --no-push      # 只检查与重建，不提交
 *   node scripts/daily-run.cjs --dry-run      # 全跑但不提交、不通知
 *   node scripts/daily-run.cjs --allow-lint-issues  # 一致性检查有遗留问题时仍推送
 *   node scripts/daily-run.cjs --notify-even-if-empty  # 无更新时也发日报（默认不发）
 *
 * 收尾会给「今日新增文章」跑一次易读性体检（scripts/readability.cjs），
 * 只汇报不阻断；真正的成稿门槛在 skills/daily-writer/SKILL.md 第七节。
 *
 * 退出码：
 *   0  正常（含「今日无变更」）
 *   1  一致性检查未通过或推送失败
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { notify } = require('./notify.cjs');
const { analyzeFile, collectToday } = require('./readability.cjs');

const ROOT = path.resolve(__dirname, '..');
const POST_DIR = path.join(ROOT, 'post');
const LOG_DIR = path.join(ROOT, '.tools', 'radar');

const argv = process.argv.slice(2);
const NO_PUSH = argv.includes('--no-push');
const DRY_RUN = argv.includes('--dry-run');
const ALLOW_LINT = argv.includes('--allow-lint-issues');
const FORCE_NOTIFY = argv.includes('--notify-even-if-empty');

const steps = [];
let newPosts = [];

/* ─────────── 工具 ─────────── */

function sh(cmd, quiet) {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    if (!quiet && out.trim()) console.log(out.trim());
    return { ok: true, out: out || '' };
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).trim();
    if (!quiet && out) console.log(out);
    return { ok: false, out };
  }
}

function step(name, ok, detail) {
  steps.push({ name, ok, detail: detail || '' });
  console.log((ok ? '✅ ' : '⚠️  ') + name + (detail ? ' — ' + detail : ''));
}

/**
 * 文章数以 home/articles.js 的索引为准。
 * 早期实现数的是 post/ 下的目录数，但一个目录可以放多篇文章
 * （如 post/deepseek/ 下就有 deepseek.html 与 api/api.html），
 * 会稳定少报，故改为解析索引里的 url 字段（每篇一条，categories 没有 url）。
 */
function countPosts() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'home', 'articles.js'), 'utf8');
    const n = (src.match(/\burl\s*:\s*['"]/g) || []).length;
    if (n > 0) return n;
  } catch (e) {
    /* 索引读不到，回退目录计数 */
  }
  try {
    return fs
      .readdirSync(POST_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).length;
  } catch (e) {
    return 0;
  }
}

/**
 * git status 里「真正新增的文章」。
 * 只认 post/<id>/<id>.html 这个新建文件，不认同目录下新增的 cover.webp / cover.jpg，
 * 也不认 post/_shared/ 这类生成物目录。早期版本按 post/<id>/ 前缀统计，
 * 一次批量补 34 张 cover.webp 就把 3 篇新稿误报成 35 篇，commit message 与邮件都错了。
 */
function detectNewPosts() {
  const r = sh('git status --porcelain -uall', true);
  const ids = new Set();
  for (const line of r.out.split('\n')) {
    const m = line.match(/^\?\?\s+post\/([^/]+)\/\1\.html$/);
    if (m && !m[1].startsWith('_')) ids.add(m[1]);
  }
  return [...ids];
}

function aheadCount() {
  const r = sh('git rev-list --count origin/main..HEAD', true);
  return r.ok ? Number(r.out.trim() || 0) : 0;
}

function currentBranch() {
  const r = sh('git rev-parse --abbrev-ref HEAD', true);
  return r.ok ? r.out.trim() : 'main';
}

/* ─────────── 主流程 ─────────── */

async function main() {
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const before = countPosts();

  console.log('─────────────────────────────────────────');
  console.log('  daily-run · ' + today);
  console.log('─────────────────────────────────────────');

  // 1. 一致性检查（先修可修的）
  sh('node scripts/repo-lint.cjs --fix', true);
  const lint = sh('node scripts/repo-lint.cjs', true);
  if (!lint.ok) {
    const tail = lint.out.split('\n').filter(Boolean).slice(-3).join(' / ');
    step('一致性检查', false, tail || '存在未修复的问题');
  } else {
    step('一致性检查', true, '全部通过');
  }

  // 2. 重建 feed / sitemap
  const build = sh('node scripts/build-index.cjs', true);
  step('重建 feed.xml / sitemap.xml', build.ok, build.ok ? '' : '失败，见日志');

  // 3. 变更检测
  const status = sh('git status --porcelain', true);
  const dirty = status.out.trim().length > 0;
  const ahead = aheadCount();
  newPosts = detectNewPosts();
  const after = countPosts();

  const countLine =
    newPosts.length > 0
      ? `文章 ${before} → ${after}（新增 ${newPosts.length} 篇）`
      : `文章 ${after} 篇（无新增）`;

  if (!dirty && ahead === 0) {
    step('变更检测', true, '无变更');
    await finish({
      today,
      t0,
      ok: lint.ok,
      countLine,
      lintOk: lint.ok,
      buildOk: build.ok,
      pushed: false,
      noChange: true,
    });
    return;
  }

  step('变更检测', true, dirty ? '工作区有改动' : `本地领先 origin ${ahead} 个提交`);

  // 4. 提交与推送
  let pushed = false;
  let pushError = '';

  if (DRY_RUN) {
    step('提交推送', true, 'dry-run，已跳过');
  } else if (NO_PUSH) {
    step('提交推送', true, '--no-push，已跳过');
  } else if (!lint.ok && !ALLOW_LINT) {
    step('提交推送', false, '一致性检查未通过，已阻止推送');
  } else {
    const branch = currentBranch();
    if (dirty) {
      sh('git add -A', true);
      const msg =
        newPosts.length > 0
          ? `chore(daily): 新增 ${newPosts.length} 篇文章并重建索引（${today}）`
          : `chore(daily): 重建索引与站点数据（${today}）`;
      const commit = sh('git commit -m "' + msg + '"', true);
      if (!commit.ok) {
        pushError = '提交失败';
        step('提交推送', false, pushError);
      }
    }
    if (!pushError) {
      let push = sh('git push origin HEAD:main', true);
      if (!push.ok) {
        // 远端常被 stars.yml 定时快照抢先（2026-11-07 / 11-08 实测）。先 rebase 再重试一次；
        // 仅星标数据冲突且本地快照更新时自动解决，其余冲突 abort 保留现场交给人工。
        const pull = sh('git pull --rebase origin main', true);
        if (pull.ok) {
          push = sh('git push origin HEAD:main', true);
        } else {
          // 只有「冲突全部落在星标数据文件」且「本次提交的快照日期不旧于远端」
          // 才自动取本地版本；其余情况一律 abort 保留现场交给人工取舍。
          // rebase 中 --theirs 指被重放的本地提交，--ours 才是远端。
          const conflicts = sh('git diff --name-only --diff-filter=U', true);
          const files = (conflicts.out || '').split('\n').map(s => s.trim()).filter(Boolean);
          const starsOnly =
            files.length > 0 && files.every(f => /^nav\/stars\/(data|rank)\.json$/.test(f));
          let resolved = false;
          if (starsOnly) {
            const stamp = ref => {
              const r = sh('git show ' + ref + ':nav/stars/data.json', true);
              if (!r.ok) return '';
              try { return JSON.parse(r.out).updated || ''; } catch (e) { return ''; }
            };
            const mine = stamp('REBASE_HEAD');
            const theirs = stamp('HEAD');
            if (mine && theirs && mine >= theirs) {
              const co = sh('git checkout --theirs ' + files.join(' '), true);
              if (co.ok) {
                sh('git add ' + files.join(' '), true);
                const cont = sh('git -c core.editor=true rebase --continue', true);
                if (cont.ok) {
                  resolved = true;
                  push = sh('git push origin HEAD:main', true);
                }
              }
            }
          }
          if (!resolved) sh('git rebase --abort', true);
        }
      }
      pushed = push.ok;
      if (!push.ok) {
        pushError = push.out.split('\n').filter(Boolean).slice(-2).join(' / ') || '推送失败';
      }
      step('提交推送', push.ok, push.ok ? '已推送到 main' : pushError);
    }
  }

  await finish({
    today,
    t0,
    ok: lint.ok && build.ok && (pushed || DRY_RUN || NO_PUSH || !dirty),
    countLine,
    lintOk: lint.ok,
    buildOk: build.ok,
    pushed,
    pushError,
    noChange: false,
  });
}

/* ─────────── 收尾：日志 + 通知 ─────────── */

async function finish(r) {
  const secs = ((Date.now() - r.t0) / 1000).toFixed(1);
  const lines = [];

  if (r.noChange) {
    lines.push('今天没有新内容，站点无需更新。');
  } else {
    lines.push(r.countLine);
    if (r.pushed) lines.push('已推送到 main，Pages 正在构建。');
    else if (r.pushError) lines.push('推送失败：' + r.pushError);
  }
  if (!r.lintOk) lines.push('一致性检查有遗留问题，建议人工看一眼。');
  if (!r.buildOk) lines.push('feed / sitemap 重建失败。');

  // 今日新增文章的易读性体检：只汇报，不阻断推送
  let readRows = [];
  try {
    readRows = collectToday(r.today).filter(x => !x.error);
  } catch (e) { /* 台账读不到时退回 git 检测 */ }
  if (!readRows.length && newPosts.length) {
    readRows = newPosts
      .map(id => analyzeFile(path.join(POST_DIR, id, id + '.html')))
      .filter(x => !x.error);
  }
  if (readRows.length) {
    const avg = Math.round(readRows.reduce((a, b) => a + b.score, 0) / readRows.length);
    const low = readRows.slice().sort((a, b) => a.score - b.score)[0];
    const lowId = path.basename(low.label, '.html');
    lines.push(`易读性体检 ${readRows.length} 篇 · 平均 ${avg} 分 · 最低 ${low.score} 分（${lowId}）`);
  }

  lines.push('耗时 ' + secs + 's');

  const title = r.noChange
    ? '博客日报 · 无更新'
    : r.pushError
      ? '博客日报 · 推送失败'
      : r.lintOk && r.buildOk
        ? '博客日报 · 已更新'
        : '博客日报 · 有告警';

  const body = lines.join('\n');

  // 落日志（.tools 已 gitignore）
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(LOG_DIR, 'daily-run.log'),
      `[${new Date().toISOString()}] ${title}\n${body}\n---\n`,
      'utf8'
    );
  } catch (e) {
    /* 日志失败不影响主流程 */
  }

  console.log('─────────────────────────────────────────');
  console.log(body);
  // 无更新的日子不再发「无更新」邮件：每天一封空日报只会让人忽略真告警。
  // 日志仍然落盘，需要强制发信时加 --notify-even-if-empty。
  if (DRY_RUN) {
    console.log('(dry-run 未发送通知)');
  } else if (r.noChange && !FORCE_NOTIFY) {
    console.log('(无更新，按配置跳过通知邮件)');
  } else {
    await notify({ title, body });
  }

  process.exit(r.ok ? 0 : 1);
}

main().catch(e => {
  console.error('daily-run 异常:', e && e.message);
  process.exit(1);
});
