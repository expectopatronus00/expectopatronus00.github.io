#!/usr/bin/env node
/**
 * stars-rank.cjs · 开源 AI 星标增速榜（Top 100）
 * -----------------------------------------
 * 读 nav/data.json 里 ai-oss（开源 AI 项目）类目的 100 个仓库，
 * 逐个查 GitHub API 拿实时星标与创建时间，算出「近 30 天增量」，
 * 写进 nav/stars/rank.json 供导航页渲染榜单。
 *
 * 增速口径（GitHub 不提供公开的历史星标接口，只能分三档凑）：
 *   1. monthly   —— 描述里人工整理的「本周/本月 +X 万星」，最可信，本周按 ×30/7 折算
 *   2. lifetime  —— 库龄 ≤ 90 天的新库，用「创建以来星标 ÷ 库龄 × 30」外推
 *                   库龄 ≤ 30 天时整个生命周期都落在窗口内，直接等于总星标
 *   3. none      —— 老库且没有月度数据，留空不猜
 *
 * 用法：
 *   node scripts/stars-rank.cjs               # 抓取并写入
 *   node scripts/stars-rank.cjs --dry-run     # 只打印前 10 名，不落盘
 *   node scripts/stars-rank.cjs --offline     # 不联网，只用 data.json 里已有描述
 *
 * 令牌：优先 GITHUB_TOKEN，本地回落 `gh auth token`。
 * 退出码：0 全部成功；1 有仓库抓取失败（其余仍然写入）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'nav', 'data.json');
const OUT = path.join(ROOT, 'nav', 'stars', 'rank.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const OFFLINE = argv.includes('--offline');
const CONCURRENCY = 4;
const WINDOW = 30;
const NEW_REPO_DAYS = 90;

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return '';
  }
}
const TOKEN = resolveToken();

/* ─────────── HTTP ─────────── */

function apiGet(pathname, redirects) {
  const left = redirects === undefined ? 2 : redirects;
  return new Promise(resolve => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: pathname,
        timeout: 20000,
        headers: {
          'User-Agent': 'blog-stars-rank/1.0',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
        },
      },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          // 仓库改名会返回 301，Location 里是新的 api 路径
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
            const loc = res.headers.location.replace(/^https:\/\/api\.github\.com/, '');
            resolve(apiGet(loc, left - 1));
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
            resolve({ ok: false, error: res.statusCode + ' 限流或无权访问' });
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

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

/* ─────────── 文本与数值 ─────────── */

// 「本周 +8.8 万星」「本月 +9.7 千星」「一周 +2.3 万星」→ { win, inc }
// 注意别把「两个月 26 万星」这种总量描述当成增量
const WEEK_WORDS = ['本周', '一周', '近一周'];
const MONTH_WORDS = ['本月', '近一月', '一个月'];

function parseInc(desc) {
  const m = desc.match(/(本周|一周|近一周|本月|近一月|一个月)\s*\+?\s*([\d.]+)\s*(万|千)星/);
  if (!m) return null;
  const v = parseFloat(m[2]) * (m[3] === '千' ? 1000 : 10000);
  if (!isFinite(v) || v <= 0) return null;
  return { win: WEEK_WORDS.indexOf(m[1]) > -1 ? '本周' : '本月', inc: Math.round(v) };
}

// 把描述里的增速短语剪掉，增速单独成列后不该再重复一遍
const INC_RE = /(?:本周|一周|近一周|本月|近一月|一个月)\s*\+?\s*[\d.]+\s*[万千]星/;

function stripInc(desc) {
  const i = desc.search(INC_RE);
  if (i < 0) return desc.trim();
  // 整句以增速开头时，剪掉后还要去掉紧跟的冒号
  if (i === 0) return desc.replace(INC_RE, '').replace(/^[：:，,、\s]+/, '').trim();
  return desc.slice(0, i).replace(/[；;，,、\s]+$/, '').trim();
}

function localToday() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const TODAY = localToday();

/* ─────────── 主流程 ─────────── */

async function main() {
  const nav = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const cat = nav.categories.find(c => c.id === 'ai-oss');
  if (!cat) {
    console.error('nav/data.json 里找不到 ai-oss 类目');
    process.exit(1);
  }

  const rows = cat.items.map((item, i) => ({
    repo: item.url.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''),
    name: item.name,
    url: item.url,
    desc: stripInc(item.desc || ''),
    badge: item.badge || '',
    origin: i + 1,
    inc: parseInc(item.desc || ''),
  }));

  let failed = [];

  if (!OFFLINE) {
    const metas = await mapLimit(rows, CONCURRENCY, r => apiGet('/repos/' + r.repo));
    rows.forEach((r, i) => {
      const m = metas[i];
      if (!m.ok) {
        failed.push(r.repo + ' → ' + m.error);
        return;
      }
      r.stars = m.data.stargazers_count;
      r.forks = m.data.forks_count;
      r.lang = m.data.language || '';
      r.created = (m.data.created_at || '').slice(0, 10);
      r.archived = !!m.data.archived;
      r.age = r.created
        ? Math.max(1, Math.round((new Date(TODAY) - new Date(r.created)) / 86400000))
        : null;
    });
  }

  // 增速三档：先算日均新增，再由日均派生「近 30 天估算」
  // 周数据只除以 7，不再乘 30/7 —— 一周爆发多是事件驱动，线性外推会离谱
  for (const r of rows) {
    if (r.inc) {
      r.daily = Math.round(r.inc.inc / (r.inc.win === '本周' ? 7 : 30));
      r.basis = r.inc.win === '本周' ? 'week' : 'month';
      if (r.inc.win === '本周') r.inc7 = r.inc.inc;
    } else if (r.age && r.age <= NEW_REPO_DAYS && typeof r.stars === 'number') {
      r.daily = Math.round(r.stars / r.age);
      r.basis = 'lifetime';
    } else {
      r.daily = null;
      r.basis = 'none';
    }
    r.d30 = r.daily === null ? null : r.daily * WINDOW;
    delete r.inc;
  }

  // 按日均新增降序，没数据的沉底，同分按总星标
  rows.sort((a, b) => {
    if (a.daily === null && b.daily === null) return (b.stars || 0) - (a.stars || 0);
    if (a.daily === null) return 1;
    if (b.daily === null) return -1;
    if (b.daily !== a.daily) return b.daily - a.daily;
    return (b.stars || 0) - (a.stars || 0);
  });
  rows.forEach((r, i) => (r.rank = i + 1));

  const payload = {
    updated: TODAY,
    window: WINDOW,
    newRepoDays: NEW_REPO_DAYS,
    total: rows.length,
    withDelta: rows.filter(r => r.daily !== null).length,
    items: rows,
  };

  if (DRY_RUN) {
    console.log('（dry-run，不落盘）\n');
    rows.slice(0, 12).forEach(r => {
      console.log(
        String(r.rank).padStart(3) + '. ' +
        r.name.padEnd(24) +
        ' 日均=' + String(r.daily === null ? '—' : r.daily).padStart(6) +
        '  近30天≈' + String(r.d30 === null ? '—' : r.d30).padStart(7) +
        '  总=' + String(r.stars || '—').padStart(7) +
        '  库龄=' + String(r.age || '—').padStart(5) +
        '  ' + r.basis
      );
    });
    console.log('\n有增速 ' + payload.withDelta + '/' + payload.total);
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n', 'utf8');
    console.log('已写入 ' + path.relative(ROOT, OUT));
    console.log('  项目 ' + payload.total + ' 个，其中有增速 ' + payload.withDelta + ' 个');
    const bySrc = {};
    rows.forEach(r => (bySrc[r.basis] = (bySrc[r.basis] || 0) + 1));
    console.log('  口径分布 ' + JSON.stringify(bySrc));
  }

  if (failed.length) {
    console.error('\n抓取失败 ' + failed.length + ' 个：');
    failed.forEach(f => console.error('  ' + f));
    process.exit(1);
  }
}

main().catch(e => {
  console.error('运行失败：' + e.message);
  process.exit(1);
});
