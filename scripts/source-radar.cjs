#!/usr/bin/env node
/**
 * source-radar.cjs · 信源雷达（第一期）
 * -----------------------------------------
 * 收集「可能值得转载」的候选内容，产出候选清单，不做任何发布。
 *
 *   node scripts/source-radar.cjs [天数]
 *
 * 信源：
 *   1. 本机浏览器历史（Edge + Chrome）中三大平台的留痕
 *      —— douyin / mp.weixin.qq.com / xiaohongshu，默认回溯 30 天
 *   2. 手动收件箱 .tools/radar/inbox.txt（每行一个链接，看完即删）
 *
 * 输出：
 *   .tools/radar/candidates-<日期>.md   候选清单（带元数据），供评分闸门审阅
 *
 * 微信/小红书正文抓取不在本脚本内：wx 文章可后续用 wx-post-quick 处理，
 * xhs 有签名墙，只记录链接。GitHub 趋势由运行时的 agent 用 WebFetch 完成。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const RADAR_DIR = path.join(ROOT, '.tools', 'radar');
const INBOX = path.join(RADAR_DIR, 'inbox.txt');
const DAYS = Number(process.argv[2] || 30);
const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function httpsGet(url, ua) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'zh-CN,zh;q=0.9' } }, res => {
        if (res.statusCode >= 300 && res.headers.location) {
          httpsGet(res.headers.location, ua).then(resolve, reject);
          res.resume();
          return;
        }
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => resolve(d));
      })
      .on('error', reject);
  });
}

/* ---------- 信源 1：浏览器历史 ---------- */
function mineBrowserHistory(days) {
  const profiles = [
    ['Edge', path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'History')],
    ['Chrome', path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'History')],
  ];
  const DOMAIN_RE = /douyin\.com|iesdouyin|mp\.weixin\.qq\.com|xiaohongshu\.com|xhslink/i;
  const cutoff = Date.now() - days * 86400000;
  const found = new Map(); // url -> { platform, url, title, when }

  for (const [browser, db] of profiles) {
    if (!fs.existsSync(db)) continue;
    const tmp = path.join(os.tmpdir(), 'radar-history-' + browser);
    fs.copyFileSync(db, tmp); // History 被浏览器锁定，复制后读
    let rows;
    try {
      const { DatabaseSync } = require('node:sqlite');
      /* Chrome 时间戳为微秒大整数，超出 JS 安全整数范围，在 SQL 内换算成 Unix 秒 */
      rows = new DatabaseSync(tmp)
        .prepare(
          'SELECT url, title, CAST(last_visit_time/1000000 - 11644473600 AS INTEGER) AS ts FROM urls'
        )
        .all();
    } catch (e) {
      console.error('  [radar] ' + browser + ' 历史读取失败: ' + e.message);
      continue; // node:sqlite 不可用时跳过该源
    }
    for (const r of rows) {
      if (!DOMAIN_RE.test(r.url)) continue;
      const when = new Date(r.ts * 1000);
      if (when.getTime() < cutoff) continue;
      const platform = /douyin/i.test(r.url)
        ? '抖音'
        : /weixin/i.test(r.url)
          ? '微信'
          : '小红书';
      const prev = found.get(r.url);
      if (!prev || when > prev.when) {
        found.set(r.url, { platform, url: r.url, title: r.title || '', when });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.when - a.when);
}

/* ---------- 抖音视频元数据（爬虫 UA 触发 SSR） ---------- */
async function douyinMeta(url) {
  const vid = (url.match(/video\/(\d+)/) || [])[1];
  if (!vid) return null;
  try {
    const html = await httpsGet('https://www.iesdouyin.com/share/video/' + vid + '/', GOOGLEBOT_UA);
    const un = s => (s || '').replace(/&amp;/g, '&');
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/);
    const author = html.match(/video_brand_name" content="([^"]*)"/) || html.match(/"nickname":"([^"]*)"/);
    const desc = html.match(/name="description" content="([^"]*)"/);
    return {
      vid,
      title: title ? un(title[1]).slice(0, 120) : '',
      author: author ? un(author[1]) : '',
      publishNote: desc ? un(desc[1]).slice(-80) : '',
      url: 'https://www.douyin.com/video/' + vid,
    };
  } catch (e) {
    return { vid, title: '', author: '', url: 'https://www.douyin.com/video/' + vid, error: String(e) };
  }
}

/* ---------- 微信文章元数据（公开可抓） ---------- */
async function wxMeta(url) {
  try {
    const html = await httpsGet(url, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const g = k => {
      const m = html.match(new RegExp('property="og:' + k + '" content="([^"]*)"'));
      return m ? m[1].replace(/&amp;/g, '&') : '';
    };
    return { title: g('title'), desc: g('description').slice(0, 100), url };
  } catch (e) {
    return { title: '', url, error: String(e) };
  }
}

/* ---------- 主流程 ---------- */
(async () => {
  fs.mkdirSync(RADAR_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  const candidates = [];

  // 信源 1：浏览器历史
  const history = mineBrowserHistory(DAYS);
  lines.push('## 一、浏览器历史留痕（近 ' + DAYS + ' 天，自动）\n');
  const seenVid = new Set();
  for (const h of history) {
    if (h.platform === '抖音') {
      const vid = (h.url.match(/video\/(\d+)/) || [])[1];
      if (!vid || seenVid.has(vid)) continue;
      seenVid.add(vid);
      const meta = await douyinMeta(h.url);
      if (meta) {
        candidates.push({ platform: '抖音', ...meta, seenAt: h.when.toISOString().slice(0, 16) });
        lines.push(
          '- [抖音] ' + (meta.title || '(无标题)') + '｜作者: ' + (meta.author || '?') +
          '｜' + meta.url + '｜浏览于 ' + h.when.toISOString().slice(0, 10)
        );
        continue;
      }
    }
    lines.push('- [' + h.platform + '] ' + (h.title || '(无标题)') + '｜' + h.url.slice(0, 100));
  }
  if (!history.length) lines.push('（近 ' + DAYS + ' 天无留痕）');

  // 信源 2：手动收件箱
  lines.push('\n## 二、手动收件箱（.tools/radar/inbox.txt）\n');
  if (fs.existsSync(INBOX)) {
    const urls = fs.readFileSync(INBOX, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    for (const url of urls) {
      let meta = { title: '', url };
      if (/douyin|iesdouyin/.test(url)) {
        const m = await douyinMeta(url);
        if (m) meta = m;
      } else if (/mp\.weixin\.qq\.com/.test(url)) {
        meta = await wxMeta(url);
      }
      candidates.push({ platform: /douyin/.test(url) ? '抖音' : /weixin/.test(url) ? '微信' : '小红书', ...meta });
      lines.push('- [' + (/douyin/.test(url) ? '抖音' : /weixin/.test(url) ? '微信' : '小红书') + '] ' + (meta.title || '(待人工看)') + '｜' + url);
    }
    fs.writeFileSync(INBOX, '', 'utf8'); // 读后清空
    if (!urls.length) lines.push('（收件箱为空）');
  } else {
    lines.push('（收件箱不存在：把链接逐行放进 ' + INBOX + '，下次运行自动收）');
  }

  lines.push(
    '\n## 三、待 agent 补充\n\n' +
    '- GitHub 趋势（月榜 / 周榜 + API 新库查询）由运行时 agent 用 WebFetch 完成后并入本清单\n' +
    '- 微信公众号订阅（wewe-rss）为第二期信源\n'
  );

  const outFile = path.join(RADAR_DIR, 'candidates-' + today + '.md');
  const header =
    '# 信源雷达候选 · ' + today + '\n\n' +
    '> 只挑不发。下一步：按 skills/source-radar/SKILL.md 的评分闸门打分，\n' +
    '> ≥75 分进入生成草稿，50–74 待定，<50 丢弃。每天最多 3 篇进入生成。\n\n' +
    lines.join('\n') + '\n';
  fs.writeFileSync(outFile, header, 'utf8');
  console.log('候选 ' + candidates.length + ' 条 → ' + outFile);
})();
