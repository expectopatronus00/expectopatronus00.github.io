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

const ROOT = path.resolve(__dirname, '..');
const POST_DIR = path.join(ROOT, 'post');
const LOG_DIR = path.join(ROOT, '.tools', 'radar');

const argv = process.argv.slice(2);
const NO_PUSH = argv.includes('--no-push');
const DRY_RUN = argv.includes('--dry-run');
const ALLOW_LINT = argv.includes('--allow-lint-issues');

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

function countPosts() {
  try {
    return fs
      .readdirSync(POST_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).length;
  } catch (e) {
    return 0;
  }
}

/** git status 里新增的文章目录 */
function detectNewPosts() {
  const r = sh('git status --porcelain -uall', true);
  const ids = new Set();
  for (const line of r.out.split('\n')) {
    const m = line.match(/^\?\?\s+post\/([^/]+)\//);
    if (m) ids.add(m[1]);
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
      const push = sh('git push origin HEAD:main', true);
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
  if (!DRY_RUN) {
    await notify({ title, body });
  } else {
    console.log('(dry-run 未发送通知)\n' + title + '\n' + body);
  }

  process.exit(r.ok ? 0 : 1);
}

main().catch(e => {
  console.error('daily-run 异常:', e && e.message);
  process.exit(1);
});
