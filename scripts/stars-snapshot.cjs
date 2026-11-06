#!/usr/bin/env node
/**
 * stars-snapshot.cjs · 每日星标快照
 * -----------------------------------------
 * 数据源是 nav/data.json 里 ai-oss 类目的 100 个仓库 —— 和星标增速榜同一套清单，
 * 逐个查 GitHub API，把当天的 star / fork 数追加进 nav/stars/data.json 的时间序列。
 *
 * 用法：
 *   node scripts/stars-snapshot.cjs                 # 抓取并写入
 *   node scripts/stars-snapshot.cjs --dry-run       # 只打印，不落盘
 *   node scripts/stars-snapshot.cjs --days 90       # 只保留最近 90 天（默认 180）
 *   node scripts/stars-snapshot.cjs --only a/b,c/d  # 只更新指定仓库
 *
 * 令牌：优先用环境变量 GITHUB_TOKEN（Actions 里自动有），本地可用 `gh auth token`。
 * 无令牌时限流 60 次/小时 —— 100 个仓库跑不完，会中途 403。
 *
 * 退出码：0 全部成功；1 有仓库抓取失败（其余仍然写入）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'nav', 'stars');
const NAV = path.join(ROOT, 'nav', 'data.json');
const DATA = path.join(DIR, 'data.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const argVal = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const KEEP_DAYS = Number(argVal('--days') || 180);
const ONLY = argVal('--only')
  ? argVal('--only').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  : null;

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 8000 }).trim();
  } catch (e) {
    return '';
  }
}

const TOKEN = resolveToken();
const CONCURRENCY = 5;

/* ─────────── HTTP ─────────── */

function apiGet(pathname, redirects) {
  const hops = redirects || 0;
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
          // 301 代表仓库改名，Location 里是新的 api 路径
          if (res.statusCode === 301 || res.statusCode === 307 || res.statusCode === 308) {
            const loc = res.headers.location;
            if (loc && hops < 3) {
              const next = loc.startsWith('http') ? loc.replace(/^https?:\/\/[^/]+/, '') : loc;
              resolve(apiGet(next, hops + 1));
              return;
            }
            resolve({ ok: false, error: '重定向次数过多' });
            return;
          }
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
  // 统一用 UTC 日期，Actions 和本地不会因时区偏移导致 series 日期错位
  return new Date().toISOString().slice(0, 10);
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

/** 从 https://github.com/owner/repo 里抠出 owner/repo */
function repoFromUrl(url) {
  const m = /github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(url || '');
  if (!m) return null;
  return (m[1] + '/' + m[2]).replace(/\.git$/i, '').replace(/\/+$/, '');
}

/** 读 nav/data.json 的 ai-oss 类目，映射成 [{repo, name, desc, badge}] */
function loadTargets() {
  const nav = loadJson(NAV, null);
  const cats = (nav && nav.categories) || [];
  const cat = cats.find(c => c && c.id === 'ai-oss');
  if (!cat || !Array.isArray(cat.items)) return null;

  const out = [];
  const seen = new Set();
  for (const it of cat.items) {
    const repo = repoFromUrl(it.url);
    if (!repo) continue;
    const key = repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      repo,
      name: it.name || repo.split('/')[1],
      desc: it.desc || '',
      badge: it.badge || '',
    });
  }
  return out;
}

/**
 * 按库龄分档 —— 这批仓库没有人工分类，库龄是最能解释「为什么它增速快」的维度：
 * 刚建三个月的库天然冲得猛，一年的老库靠月度趋势才看得出。
 */
function ageBucket(created) {
  if (!created) return '未知库龄';
  const t = Date.parse(created + 'T00:00:00Z');
  if (!isFinite(t)) return '未知库龄';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 30) return '30 天内';
  if (days <= 90) return '31–90 天';
  if (days <= 365) return '1 年内';
  return '1 年以上';
}

/* ─────────── 主流程 ─────────── */

async function main() {
  const all = loadTargets();
  if (!all || !all.length) {
    console.error('读不到 ' + NAV + ' 的 ai-oss 类目，或 items 为空');
    process.exit(1);
  }

  const data = loadJson(DATA, { updated: '', repos: [], series: {} });
  data.series = data.series || {};
  data.repos = data.repos || [];

  const day = today();
  const targets = ONLY ? all.filter(t => ONLY.indexOf(t.repo.toLowerCase()) >= 0) : all;
  if (!targets.length) {
    console.error('--only 过滤后没有剩余仓库');
    process.exit(1);
  }

  console.log('─────────────────────────────────────────');
  console.log('  stars-snapshot · ' + day + ' · ' + targets.length + ' / ' + all.length + ' 个仓库');
  console.log('  令牌：' + (TOKEN ? '有' : '无（限流 60 次/小时，100 个仓库跑不完）'));
  console.log('─────────────────────────────────────────');

  if (!TOKEN && targets.length > 55) {
    console.warn('⚠️  没有 GITHUB_TOKEN，本次大概率中途 403。本地请先 `gh auth login`。');
  }

  const byRepo = new Map(data.repos.map(r => [r.repo, r]));
  const failures = [];
  let done = 0;

  // 简单的并发池
  var rateLimited = false;
  async function worker(queue) {
    while (queue.length) {
      if (rateLimited) { queue.length = 0; break; }
      const item = queue.shift();
      const res = await fetchRepo(item.repo);
      done++;
      if (!res.ok) {
        if (res.fatal) {
          rateLimited = true;
          failures.push({ repo: item.repo, error: res.error });
          console.log('❌ ' + item.repo + ' — ' + res.error + '（停止剩余请求）');
          queue.length = 0;
          break;
        }
        failures.push({ repo: item.repo, error: res.error });
        console.log('❌ ' + item.repo + ' — ' + res.error);
        continue;
      }
      const d = res.data;
      const stars = d.stargazers_count;
      const prev = byRepo.get(item.repo) || {};
      byRepo.set(item.repo, {
        // repo 是稳定主键（来自 nav/data.json），仓库改名时 fullName 会变但序列不断
        repo: item.repo,
        fullName: d.full_name || item.repo,
        name: d.name || item.name,
        owner: d.owner ? d.owner.login : item.repo.split('/')[0],
        desc: item.desc || (d.description || '').slice(0, 140),
        category: ageBucket((d.created_at || '').slice(0, 10)),
        note: item.badge,
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
      console.log('✅ ' + (d.full_name || item.repo).padEnd(42) + String(stars).padStart(8) + delta);
    }
  }

  const queue = targets.slice();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue)));

  // 只保留 nav/data.json 里仍在的仓库，避免删条目后数据残留
  const keep = new Set(all.map(t => t.repo));
  data.repos = [...byRepo.values()].filter(r => keep.has(r.repo));
  data.series = prune(data.series, KEEP_DAYS);
  for (const k of Object.keys(data.series)) {
    if (!keep.has(k)) delete data.series[k];
  }
  data.updated = day;

  console.log('');
  const covered = Object.keys(data.series).length;
  console.log(
    '成功 ' + (targets.length - failures.length) + ' / ' + targets.length +
      '，序列覆盖 ' + covered + ' / ' + all.length + ' 个仓库'
  );

  // 少量仓库 404 / 改名不影响整份快照：沿用它们上一次的数值即可。
  // 只有触发限流、失败比例超 5%、或序列覆盖不全时才判失败，避免 Actions 天天红灯。
  const tolerated = failures.length <= Math.max(3, Math.ceil(targets.length * 0.05));
  const bad = rateLimited || !tolerated || covered < all.length;
  if (!bad && failures.length) {
    console.log('提示：' + failures.length + ' 个仓库本次未取到，沿用上次快照；序列覆盖完整，按降级成功处理');
    failures.slice(0, 10).forEach(f => console.log('  · ' + f.repo + ' — ' + f.error));
  }

  if (DRY_RUN) {
    console.log('(dry-run 未写入 ' + DATA + ')');
    process.exit(bad ? 1 : 0);
  }

  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('已写入 ' + path.relative(ROOT, DATA));
  process.exit(bad ? 1 : 0);
}

main().catch(e => {
  console.error('stars-snapshot 异常:', e && e.message);
  process.exit(1);
});
