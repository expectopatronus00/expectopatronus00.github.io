#!/usr/bin/env node
/**
 * stars-snapshot.cjs · 每日星标快照
 * -----------------------------------------
 * 读 nav/stars/watchlist.json 里的仓库清单，逐个查 GitHub API，
 * 把当天的 star / fork 数追加进 nav/stars/data.json 的时间序列。
 *
 * 用法：
 *   node scripts/stars-snapshot.cjs                 # 抓取并写入
 *   node scripts/stars-snapshot.cjs --dry-run       # 只打印，不落盘
 *   node scripts/stars-snapshot.cjs --days 90       # 只保留最近 90 天（默认 180）
 *   node scripts/stars-snapshot.cjs --only a/b,c/d  # 只更新指定仓库
 *
 * 令牌：优先用环境变量 GITHUB_TOKEN（Actions 里自动有），本地可用 `gh auth token`。
 * 无令牌时限流 60 次/小时 —— 25 个仓库一天跑一次够用，但重跑几次就会撞墙。
 *
 * 退出码：0 全部成功；1 有仓库抓取失败（其余仍然写入）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'nav', 'stars');
const WATCHLIST = path.join(DIR, 'watchlist.json');
const DATA = path.join(DIR, 'data.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const argVal = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const KEEP_DAYS = Number(argVal('--days') || 180);
const ONLY = argVal('--only')
  ? argVal('--only').split(',').map(s => s.trim()).filter(Boolean)
  : null;

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const CONCURRENCY = 4;

/* ─────────── HTTP ─────────── */

function apiGet(pathname) {
  return new Promise(resolve => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: pathname,
        timeout: 20000,
        headers: {
          'User-Agent': 'blog-stars-snapshot/1.0',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
        },
      },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve({ ok: true, data: JSON.parse(body) });
            } catch (e) {
              resolve({ ok: false, error: 'JSON 解析失败' });
            }
          } else if (res.statusCode === 404) {
            resolve({ ok: false, error: '404 仓库不存在或已改名' });
          } else if (res.statusCode === 403 || res.statusCode === 429) {
            resolve({ ok: false, error: '限流 ' + res.statusCode, fatal: true });
          } else {
            resolve({ ok: false, error: 'HTTP ' + res.statusCode });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: '超时' });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRepo(repo, attempt) {
  const n = attempt || 0;
  const r = await apiGet('/repos/' + repo);
  if (!r.ok && !r.fatal && n < 2 && r.error !== '404 仓库不存在或已改名') {
    await sleep(1200 * (n + 1));
    return fetchRepo(repo, n + 1);
  }
  return r;
}

/* ─────────── 数据 ─────────── */

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function today() {
  // 用本地时区日期，避免 UTC 与北京时间的跨天错位
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function prune(series, keepDays) {
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
  const out = {};
  for (const key of Object.keys(series)) {
    const rows = series[key].filter(r => r[0] >= cutoff);
    if (rows.length) out[key] = rows;
  }
  return out;
}

/* ─────────── 主流程 ─────────── */

async function main() {
  const watch = loadJson(WATCHLIST, null);
  if (!watch || !Array.isArray(watch.repos)) {
    console.error('读不到 ' + WATCHLIST + '，或 repos 不是数组');
    process.exit(1);
  }

  const data = loadJson(DATA, { updated: '', repos: [], series: {} });
  data.series = data.series || {};
  data.repos = data.repos || [];

  const day = today();
  const targets = watch.repos.filter(w => !ONLY || ONLY.indexOf(w.repo) >= 0);

  console.log('─────────────────────────────────────────');
  console.log('  stars-snapshot · ' + day + ' · ' + targets.length + ' 个仓库');
  console.log('─────────────────────────────────────────');

  const byRepo = new Map(data.repos.map(r => [r.repo, r]));
  const failures = [];
  let done = 0;

  // 简单的并发池
  async function worker(queue) {
    while (queue.length) {
      const item = queue.shift();
      const res = await fetchRepo(item.repo);
      done++;
      if (!res.ok) {
        failures.push({ repo: item.repo, error: res.error });
        console.log('❌ ' + item.repo + ' — ' + res.error);
        continue;
      }
      const d = res.data;
      const stars = d.stargazers_count;
      const prev = byRepo.get(item.repo) || {};
      byRepo.set(item.repo, {
        repo: d.full_name,
        name: d.name,
        owner: d.owner ? d.owner.login : item.repo.split('/')[0],
        desc: (d.description || '').slice(0, 140),
        category: item.category || '未分类',
        note: item.note || '',
        license: d.license ? d.license.spdx_id : 'NOASSERTION',
        language: d.language || '',
        stars,
        forks: d.forks_count,
        openIssues: d.open_issues_count,
        created: (d.created_at || '').slice(0, 10),
        first: prev.first || day,
        last: day,
      });

      const rows = data.series[item.repo] || [];
      const idx = rows.findIndex(r => r[0] === day);
      if (idx >= 0) rows[idx][1] = stars;
      else rows.push([day, stars]);
      rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      data.series[item.repo] = rows;

      const prevStars = rows.length >= 2 ? rows[rows.length - 2][1] : null;
      const delta = prevStars === null ? '' : ' (' + (stars - prevStars >= 0 ? '+' : '') + (stars - prevStars) + ')';
      console.log('✅ ' + d.full_name.padEnd(42) + String(stars).padStart(8) + delta);
    }
  }

  const queue = targets.slice();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue)));

  // 只保留 watchlist 里仍在的仓库，避免删条目后数据残留
  const keep = new Set(watch.repos.map(w => w.repo));
  data.repos = [...byRepo.values()].filter(r => keep.has(r.repo));
  data.series = prune(data.series, KEEP_DAYS);
  data.updated = day;

  console.log('');
  console.log(
    '成功 ' + (targets.length - failures.length) + ' / ' + targets.length +
      '，序列覆盖 ' + Object.keys(data.series).length + ' 个仓库'
  );

  if (DRY_RUN) {
    console.log('(dry-run 未写入 ' + DATA + ')');
    process.exit(failures.length ? 1 : 0);
  }

  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('已写入 ' + path.relative(ROOT, DATA));
  process.exit(failures.length ? 1 : 0);
}

main().catch(e => {
  console.error('stars-snapshot 异常:', e && e.message);
  process.exit(1);
});
