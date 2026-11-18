#!/usr/bin/env node
'use strict';
/**
 * public-radar.cjs · 无账号信源采集（不需要小红书/抖音登录态）
 * ---------------------------------------------------------------
 * 只要你在浏览器里「打开过」小红书 / 抖音的内容，浏览器历史里就有链接。
 * 本脚本只依赖本地历史 + 公开 SSR 页面，不读 .tools/browser-profile，
 * 不碰任何账号 Cookie，因此登录态失效时照样能出候选。
 *
 *   node scripts/public-radar.cjs [--days 30] [--browser] [--no-expand]
 *
 * 依赖：只用 Node 内置模块（sqlite / https），不需要 playwright，不需要账号。
 * 只有加 --browser 时才 require('playwright')，需设 NODE_PATH 指向隔离工作区。
 * 信源：
 *   1. Edge / Chrome 全部 profile 的历史（抖音 / 小红书 / iesdouyin / xhslink）
 *      - v.douyin.com 短链：跟随 302 展开到 video id
 *      - 无标题的视频页：Googlebot UA 抓 iesdouyin 分享页 SSR 标题
 *   2. --browser：干净上下文（无登录）采小红书探索页公开卡片 + 抖音热搜榜
 *      这两个入口有登录墙，产出不稳定，仅作补充；默认不跑。
 *
 * 输出：
 *   .tools/radar/public-<date>.json      结构化候选
 *   .tools/radar/candidates-<date>.md    追加「四、无账号公开采集」小节（幂等）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const RADAR = path.join(ROOT, '.tools', 'radar');
const ARG = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d;
};
const DAYS = Number(ARG('days', 30));
const DO_BROWSER = process.argv.includes('--browser');
const NO_EXPAND = process.argv.includes('--no-expand');
const TODAY = new Date().toISOString().slice(0, 10);

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const AI_RE = /ai|人工智能|大模型|智能体|\bagent\b|\bskill\b|\bmcp\b|github|开源|模型|claude|codex|cursor|deepseek|\bgpt\b|\bkimi\b|qwen|通义|豆包|token|接入|部署|插件|工作流|自动化|vibe|编程|prompt|rag|llm|diffusion|stable ?diffusion/i;
const NOISE_RE = /^(小红书\s*-\s*你的生活兴趣社区|抖音精选电脑版|抖音\s*-\s*记录美好生活|发现更多精彩视频|-?\s*抖音\s*\|?)$/i;

const norm = s => String(s || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
const un = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function httpsGet(url, ua, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 6) return resolve({ error: 'too many redirects', final: url });
    const req = https.get(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'zh-CN,zh;q=0.9' } }, res => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        return resolve(httpsGet(loc.startsWith('http') ? loc : new URL(loc, url).href, ua, depth + 1));
      }
      let d = '';
      res.on('data', c => { if (d.length < 900000) d += c; });
      res.on('end', () => resolve({ body: d, final: url, status: res.statusCode }));
    });
    req.on('error', e => resolve({ error: e.message, final: url }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout', final: url }); });
  });
}

function profileHistoryFiles() {
  const roots = [
    ['Edge', path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data')],
    ['Chrome', path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data')],
  ];
  const out = [];
  for (const [browser, base] of roots) {
    if (!fs.existsSync(base)) continue;
    for (const dir of fs.readdirSync(base)) {
      if (!/^(Default|Profile \d+)$/.test(dir)) continue;
      const db = path.join(base, dir, 'History');
      if (fs.existsSync(db)) out.push({ browser, profile: dir, db });
    }
  }
  return out;
}

function readHistory(db) {
  const tmp = path.join(os.tmpdir(), 'public-radar-' + Math.random().toString(36).slice(2) + '.db');
  try {
    fs.copyFileSync(db, tmp);
    const { DatabaseSync } = require('node:sqlite');
    const rows = new DatabaseSync(tmp).prepare(
      'SELECT url, title, CAST(last_visit_time/1000000 - 11644473600 AS INTEGER) AS ts FROM urls ' +
      "WHERE url LIKE '%douyin.com%' OR url LIKE '%iesdouyin%' OR url LIKE '%v.douyin.com%' " +
      "OR url LIKE '%xiaohongshu.com%' OR url LIKE '%xhslink%' ORDER BY last_visit_time DESC LIMIT 400"
    ).all();
    return rows;
  } catch (e) {
    console.error('  [public-radar] 历史读取失败 ' + path.basename(path.dirname(db)) + ': ' + e.message);
    return [];
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function videoId(url) {
  const m = String(url).match(/(?:video|share\/video)\/(\d{10,})/);
  return m ? m[1] : null;
}

async function expandShort(url) {
  // 只跟随跳转拿最终地址，不下载正文
  return new Promise((resolve) => {
    let cur = url, hops = 0;
    const step = () => {
      if (hops++ > 6) return resolve(null);
      const req = https.get(cur, { headers: { 'User-Agent': GOOGLEBOT } }, res => {
        const loc = res.headers.location;
        res.resume();
        if (loc) { cur = loc.startsWith('http') ? loc : new URL(loc, cur).href; return step(); }
        resolve(cur);
      });
      req.on('error', () => resolve(null));
      req.setTimeout(12000, () => { req.destroy(); resolve(null); });
    };
    step();
  });
}

async function ssrMeta(id) {
  const r = await httpsGet('https://www.iesdouyin.com/share/video/' + id + '/', GOOGLEBOT);
  if (r.error || !r.body) return null;
  const html = r.body;
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const author = html.match(/video_brand_name"\s*content="([^"]*)"/) || html.match(/"nickname":"([^"]*)"/);
  const desc = html.match(/name="description"\s*content="([^"]*)"/i);
  const text = un(title ? title[1] : '') || un(desc ? desc[1] : '');
  if (!text || NOISE_RE.test(text.trim())) return null;
  return {
    title: text.slice(0, 140),
    author: author ? un(author[1]) : '',
    url: 'https://www.douyin.com/video/' + id,
  };
}

async function collectHistory(days) {
  const cutoff = Date.now() - days * 86400000;
  const box = new Map(); // key -> item
  let raw = 0, expanded = 0, ssrOk = 0;

  for (const { browser, profile, db } of profileHistoryFiles()) {
    for (const r of readHistory(db)) {
      const ts = r.ts * 1000;
      if (!ts || ts < cutoff) continue;
      raw++;
      const url = r.url;
      const isDy = /douyin|iesdouyin/i.test(url);
      const platform = isDy ? '抖音' : '小红书';
      let title = un(r.title || '').trim();
      let key = videoId(url) || norm(url).slice(0, 60) || norm(title).slice(0, 40);

      // 短链展开：v.douyin.com 历史里没有标题，必须展开拿 id
      if (isDy && !title && /v\.douyin\.com/i.test(url) && !NO_EXPAND) {
        const final = await expandShort(url);
        const id = final && videoId(final);
        if (id) {
          expanded++;
          key = id;
          const meta = await ssrMeta(id);
          if (meta) { ssrOk++; title = meta.title; }
        }
      } else if (isDy && !title && videoId(url) && !NO_EXPAND) {
        const meta = await ssrMeta(videoId(url));
        if (meta) { ssrOk++; title = meta.title; }
      }

      if (NOISE_RE.test(title)) title = '';
      const prev = box.get(key);
      if (prev && prev.title.length >= title.length) continue;
      box.set(key, {
        platform,
        title,
        url,
        videoId: videoId(url) || key,
        when: new Date(ts).toISOString().slice(0, 16).replace('T', ' '),
        source: browser + '/' + profile,
      });
    }
  }
  const all = [...box.values()].sort((a, b) => b.when.localeCompare(a.when));
  return {
    scanned: raw, expanded, ssrOk,
    all,
    ai: all.filter(x => AI_RE.test(x.title) && x.title.length >= 8),
  };
}

async function collectBrowser() {
  const { chromium } = require('playwright');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'public-radar-'));
  const ctx = await chromium.launchPersistentContext(tmp, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = await ctx.newPage();
  const out = [];
  const grab = async (name, url, sel) => {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.waitForTimeout(4000);
      for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollBy(0, 1800)); await page.waitForTimeout(1200); }
      const items = await page.$$eval(sel, els => els.map(a => ({
        href: a.href ? a.href.split('?')[0] : '',
        title: (a.getAttribute('alt') || a.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '',
      })).filter(x => x.title.length > 6).slice(0, 80));
      return items.filter(x => AI_RE.test(x.title)).map(x => ({ platform: name, ...x, when: TODAY, source: 'public-browser' }));
    } catch (e) { return []; }
  };
  out.push(...await grab('小红书', 'https://www.xiaohongshu.com/explore', "a[href*='/explore/']"));
  // 抖音热搜：公开接口，页面触发后从 DOM 文本行里取 AI 话题
  try {
    await page.goto('https://www.douyin.com/hot', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(4500);
    const hot = await page.evaluate(() => [...new Set((document.body.innerText || '').split('\n').map(s => s.trim()).filter(s => s.length > 4))]);
    out.push(...hot.filter(x => AI_RE.test(x)).slice(0, 20).map(x => ({ platform: '抖音热搜', title: x, url: 'https://www.douyin.com/hot', when: TODAY, source: 'public-browser' })));
  } catch (_) {}
  await ctx.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  return out;
}

function appendCandidates(history, browserHits) {
  const file = path.join(RADAR, 'candidates-' + TODAY + '.md');
  const BEGIN = '<!-- public-radar:begin -->';
  const END = '<!-- public-radar:end -->';
  const lines = [
    BEGIN,
    '## 四、无账号公开采集（浏览器历史 + 公开页面，无需登录）\n',
    '- 历史扫描 ' + history.scanned + ' 条 → 短链展开 ' + history.expanded + ' 条 / SSR 还原标题 ' + history.ssrOk + ' 条；AI 命中 ' + history.ai.length + ' 条',
    ...history.ai.slice(0, 25).map(x => '- [' + x.platform + '] ' + x.title.slice(0, 72) + '｜' + x.url.slice(0, 90) + '｜' + x.when),
    browserHits.length ? '- 公开页面补充 ' + browserHits.length + ' 条：' + browserHits.slice(0, 8).map(x => x.title.slice(0, 40)).join(' / ') : '- 公开页面补充 0 条（登录墙或今日无 AI 命中，属正常）',
    END,
  ].join('\n');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# 信源雷达候选 · ' + TODAY + '\n';
  text = text.replace(new RegExp(BEGIN.replace(/[-/]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[-/]/g, '\\$&')), '').trimEnd();
  fs.writeFileSync(file, text + '\n\n' + lines + '\n', 'utf8');
}

(async () => {
  fs.mkdirSync(RADAR, { recursive: true });
  console.log('[public-radar] 无账号采集 · 回溯 ' + DAYS + ' 天' + (DO_BROWSER ? ' · 含公开页面' : ''));
  const history = await collectHistory(DAYS);
  let browserHits = [];
  if (DO_BROWSER) {
    try { browserHits = await collectBrowser(); console.log('[public-radar] 公开页面 AI 命中 ' + browserHits.length + ' 条'); }
    catch (e) { console.warn('[public-radar] 公开页面采集失败（不影响历史源）：' + e.message.split('\n')[0]); }
  }
  const all = [...history.ai, ...browserHits];
  const seen = new Set();
  const unique = all.filter(x => { const k = norm(x.title).slice(0, 30); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  const outFile = path.join(RADAR, 'public-' + TODAY + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ scannedAt: new Date().toISOString(), days: DAYS, history: {
    scanned: history.scanned, expanded: history.expanded, ssrOk: history.ssrOk, ai: history.ai.length,
  }, browser: browserHits.length, candidates: unique }, null, 1), 'utf8');
  appendCandidates(history, browserHits);
  console.log('[public-radar] 历史 ' + history.scanned + ' 条 → AI ' + history.ai.length + ' 条；合计去重 ' + unique.length + ' 条 → ' + outFile);
  unique.slice(0, 12).forEach((x, i) => console.log('  ' + (i + 1) + '. [' + x.platform + '] ' + x.title.slice(0, 64)));
  process.exit(0);
})().catch(e => { console.error('[public-radar] ERR ' + e.message); process.exit(1); });
