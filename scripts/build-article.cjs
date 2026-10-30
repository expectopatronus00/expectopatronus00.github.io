#!/usr/bin/env node
/**
 * 通用文章渲染器：读一份 spec.json，产出 post/<id>/<id>.html（可选封面），
 * 并可选地同步 home/articles.js 与两处展示数字。
 *
 * 用法：
 *   node scripts/build-article.cjs --spec .tools/draft/<id>.json            # 只渲染 HTML
 *   node scripts/build-article.cjs --spec ... --cover                       # 顺带生成封面
 *   node scripts/build-article.cjs --spec ... --cover --index               # 再写入索引与计数
 *   node scripts/build-article.cjs --spec ... --remember                    # 把来源 key 写进 seen.json
 *   node scripts/build-article.cjs --spec ... --out .tools/draft/preview    # 渲染到别处，不碰仓库
 *
 * spec 字段（除 id/title/desc/lead/body 外都可省）：
 *   id, title, desc, eyebrow, lead, date, readMin, category, keywords, tags[],
 *   body 或 bodyFile（相对 spec 所在目录的 .html 片段）,
 *   cta: { heading, text, href, label },
 *   platforms: [{ href, name, desc }],
 *   cover: { eyebrow, kicker, headline[], sub, bars[{label,height}] },
 *   source: { key }   // --remember 时写入 seen.json
 *
 * 设计约束：模板复用 post/dy-20261021-skill-top20/ 的 head、样式与 footer，
 * 只替换 title/meta/page-head/正文/相关平台/标签，保证与站内既有文章同构。
 * 不依赖任何 npm 包；封面用 playwright 时按需懒加载（缺了就跳过，不报错）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'post', 'dy-20261021-skill-top20', 'dy-20261021-skill-top20.html');
const ARTICLES = path.join(ROOT, 'home', 'articles.js');
const HOME_HTML = path.join(ROOT, 'home', 'home.html');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SEEN = path.join(ROOT, '.tools', 'radar', 'seen.json');
const LEDGER = path.join(ROOT, '.tools', 'radar', 'drafts.json');

/* ─────────── 参数 ─────────── */

function parseArgs(argv) {
  const out = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.opts[key] = next;
        i++;
      } else {
        out.flags.add(key);
      }
    }
  }
  return out;
}

/* ─────────── 工具 ─────────── */

const attr = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const jsStr = s => "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function estReadMin(body) {
  const text = body.replace(/<[^>]+>/g, '');
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (text.match(/[A-Za-z]+/g) || []).length;
  return Math.max(3, Math.round(cn / 400 + en / 220));
}

function fail(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

/* ─────────── spec 载入与校验 ─────────── */

function loadSpec(file) {
  if (!fs.existsSync(file)) fail('找不到 spec：' + file);
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail('spec 不是合法 JSON：' + e.message);
  }

  if (spec.bodyFile) {
    const p = path.resolve(path.dirname(file), spec.bodyFile);
    if (!fs.existsSync(p)) fail('找不到 bodyFile：' + p);
    spec.body = fs.readFileSync(p, 'utf8');
  }

  const need = ['id', 'title', 'desc', 'lead', 'body'];
  for (const k of need) if (!spec[k] || !String(spec[k]).trim()) fail('spec 缺字段：' + k);

  if (!/^[a-z0-9][a-z0-9-]*$/.test(spec.id)) fail('id 只能是小写字母/数字/连字符：' + spec.id);
  if (spec.title.length > 60) console.warn('⚠ 标题 ' + spec.title.length + ' 字，超过 60 字建议缩短');
  if (spec.desc.length > 160) console.warn('⚠ 描述 ' + spec.desc.length + ' 字，超过 160 字建议压缩');

  spec.date = spec.date || today();
  spec.eyebrow = spec.eyebrow || 'OPEN SOURCE';
  spec.category = spec.category || 'AI 编程';
  spec.tags = Array.isArray(spec.tags) ? spec.tags.filter(Boolean) : [];
  spec.platforms = Array.isArray(spec.platforms) ? spec.platforms.filter(p => p && p.href) : [];
  spec.readMin = spec.readMin || estReadMin(spec.body);
  spec.keywords = spec.keywords || spec.tags.join(', ');
  if (spec.body.includes('cta-box')) fail('body 里不要再写 cta-box，用 spec.cta 生成');
  return spec;
}

/* ─────────── 渲染 ─────────── */

const ICON_USER =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 20c1.2-3.5 4-5 6.5-5s5.3 1.5 6.5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_CAL =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_CLOCK =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.5v5l3 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_STACK =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 7.5l9 4.5 9-4.5-9-4.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const ICON_LINK =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 7h9v9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_GH =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.48l-.01-1.7c-2.78.62-3.37-1.36-3.37-1.36-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.29.1-2.69 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 7.07c.85 0 1.7.12 2.5.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.4.2 2.43.1 2.69.64.72 1.03 1.64 1.03 2.76 0 3.94-2.35 4.8-4.58 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.58.69.48A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></svg>';
const ICON_WEB =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const ICON_VIDEO =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 9.5l4.5 2.5-4.5 2.5z" fill="currentColor"/></svg>';

const ICONS = { github: ICON_GH, web: ICON_WEB, video: ICON_VIDEO, link: ICON_LINK };

function render(spec, hasCover) {
  const tpl = fs.readFileSync(TPL, 'utf8');
  const headEnd = tpl.indexOf('<section class="page-head">');
  const articleEnd = tpl.indexOf('</article>');
  if (headEnd < 0 || articleEnd < 0) fail('模板结构变了：找不到 page-head 或 </article>');

  let prefix = tpl.slice(0, headEnd);
  prefix = prefix.replace(/<title>[\s\S]*?<\/title>/, '<title>' + attr(spec.title) + ' · EXPECTOPATRONUS</title>');
  prefix = prefix.replace(/<meta name="description" content="[\s\S]*?" \/>/, '<meta name="description" content="' + attr(spec.desc) + '" />');
  prefix = prefix.replace(/<meta name="keywords" content="[\s\S]*?" \/>/, '<meta name="keywords" content="' + attr(spec.keywords) + '" />');
  prefix = prefix.replace(/<meta property="og:title" content="[\s\S]*?" \/>/, '<meta property="og:title" content="' + attr(spec.title) + '" />');
  prefix = prefix.replace(/<meta property="og:description" content="[\s\S]*?" \/>/, '<meta property="og:description" content="' + attr(spec.desc) + '" />');

  const hero = hasCover
    ? `
    <div class="hero-image">
      <img loading="lazy" alt="${attr(spec.title)} 封面" src="cover.jpg" />
    </div>
`
    : '';

  const pageHead = `    <section class="page-head">
      <div class="eyebrow">${attr(spec.eyebrow)}</div>
      <h1>${attr(spec.title)}</h1>
      <p>${attr(spec.lead)}</p>
      <div class="meta">
        <span>${ICON_USER} expectopatronus</span>
        <span>${ICON_CAL} ${spec.date}</span>
        <span>${ICON_CLOCK} 约 ${spec.readMin} 分钟阅读</span>
        <span>${ICON_STACK} 原创 · ${attr(spec.category)}</span>
      </div>
    </section>
${hero}
    <article class="article-body">`;

  const body = spec.body.replace(/^\s+|\s+$/g, '');

  let cta = '';
  if (spec.cta && spec.cta.href) {
    cta = `
    <div class="cta-box">
      <div class="content">
        <h3>${attr(spec.cta.heading || '去看原始来源')}</h3>
        <p>${attr(spec.cta.text || '')}</p>
      <a class="cta-btn" id="cta-link" href="${attr(spec.cta.href)}" target="_blank" rel="noopener">
          ${ICON_LINK} ${attr(spec.cta.label || '前往查看')}
        </a>
      </div>
    </div>
`;
  }

  let platforms = '';
  if (spec.platforms.length) {
    const cards = spec.platforms
      .map(
        p => `      <a class="plat-card" href="${attr(p.href)}" target="_blank" rel="noopener">
        ${ICONS[p.icon] || ICON_LINK}
        <span class="pn">${attr(p.name || '链接')}</span>
        <span class="pd">${attr(p.desc || '')}</span>
      </a>`
      )
      .join('\n');
    platforms = `    <div class="platforms">
      <h2>相关平台</h2>
      <div class="platform-list">
${cards}
      </div>
    </div>
`;
  }

  const tagsRow = spec.tags.length
    ? `    <div class="tags-row">
${spec.tags.map(t => '      <a href="../../home/home.html?q=' + encodeURIComponent(t) + '">#' + attr(t) + '</a>').join('\n')}
    </div>
`
    : '';

  return prefix + pageHead + '\n' + body + '\n' + cta + platforms + tagsRow + tpl.slice(articleEnd);
}

/* ─────────── 封面 ─────────── */

async function makeCover(spec, outFile) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    return { ok: false, reason: 'playwright 不可用（需 NODE_PATH 指向隔离工作区）' };
  }

  const c = spec.cover || {};
  const headlineLines = c.headline && c.headline.length ? c.headline : [spec.title];
  const headline = headlineLines.join('<br>');
  // 短标题（如 4 个汉字）用 104px 会显得空，按「汉字记 2 个单位」粗算收一档
  const units = Math.max(
    ...headlineLines.map(l => l.replace(/<[^>]+>/g, '').replace(/[\u4e00-\u9fa5]/g, 'xx').length)
  );
  const h1Size = units <= 9 ? 86 : units >= 34 ? 78 : 104;
  const bars = (c.bars || [])
    .slice(0, 3)
    .map((b, i) => `  <div class="gate" style="height:${b.height || 96 + i * 44}px"><span>${attr(b.label || '')}</span></div>`)
    .join('\n');
  const fontRoot = ROOT.replace(/\\/g, '/');

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  @font-face{font-family:'CG';src:url('file://${fontRoot}/home/fonts/CormorantGaramond-var-normal.woff2') format('woff2');font-weight:100 900;}
  @font-face{font-family:'SS';src:url('file://${fontRoot}/home/fonts/SourceSerif4-var-normal.woff2') format('woff2');font-weight:200 900;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#0c0d11;color:#ede9df;overflow:hidden;font-family:'SS',serif;position:relative}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(237,233,223,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(237,233,223,.045) 1px,transparent 1px);background-size:60px 60px}
  .glow{position:absolute;width:760px;height:760px;right:-240px;top:-300px;border-radius:50%;background:radial-gradient(circle,rgba(184,88,29,.30),transparent 62%)}
  .wrap{position:relative;padding:66px 72px;height:100%;display:flex;flex-direction:column}
  .eyebrow{font-family:'CG',serif;font-size:19px;letter-spacing:.34em;text-transform:uppercase;color:#d4692a;margin-bottom:30px}
  .kicker{font-size:22px;color:#a8a49a;letter-spacing:.06em;margin-bottom:14px}
  h1{font-family:'CG',serif;font-weight:500;font-size:${h1Size}px;line-height:.98;letter-spacing:-.02em;margin-bottom:24px}
  h1 em{font-style:italic;color:#d4692a;font-weight:400}
  .sub{font-size:26px;line-height:1.62;color:#c9c4b8;max-width:830px}
  .gates{position:absolute;right:74px;bottom:74px;display:flex;gap:18px;align-items:flex-end}
  .gate{width:64px;background:linear-gradient(180deg,rgba(184,88,29,.9),rgba(184,88,29,.12));border-radius:6px 6px 0 0;position:relative}
  .gate span{position:absolute;bottom:-30px;left:0;right:0;text-align:center;font-family:'CG',serif;font-size:15px;letter-spacing:.16em;color:#8b877e;text-transform:uppercase}
  .foot{position:absolute;left:72px;bottom:64px;display:flex;gap:16px;align-items:center;font-size:17px;color:#7d7a72;letter-spacing:.14em}
  .dot{width:7px;height:7px;border-radius:50%;background:#b8581d}
  .rule{position:absolute;left:72px;bottom:112px;width:250px;height:1px;background:rgba(237,233,223,.22)}
</style></head><body>
<div class="grid"></div><div class="glow"></div>
<div class="wrap">
  <div class="eyebrow">${attr(c.eyebrow || spec.eyebrow)}</div>
  ${c.kicker ? '<div class="kicker">' + attr(c.kicker) + '</div>' : ''}
  <h1>${headline}</h1>
  <div class="sub">${attr(c.sub || spec.lead)}</div>
</div>
${bars ? '<div class="gates">\n' + bars + '\n</div>' : ''}
<div class="rule"></div>
<div class="foot"><span class="dot"></span><span>EXPECTOPATRONUS · ${spec.date}</span></div>
</body></html>`;

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: outFile, type: 'jpeg', quality: 92 });
    return { ok: true, size: fs.statSync(outFile).size };
  } catch (e) {
    return { ok: false, reason: e.message.split('\n')[0] };
  } finally {
    if (browser) await browser.close();
  }
}

/* ─────────── 索引 ─────────── */

function countEntries(src) {
  return (src.match(/\n\s{12}url: '/g) || []).length;
}

function removeEntry(src, id) {
  const needle = "id: " + jsStr(id) + ",";
  const pos = src.indexOf(needle);
  if (pos < 0) return src;
  const start = src.lastIndexOf('\n          {\n', pos);
  const end = src.indexOf('\n          },', pos);
  if (start < 0 || end < 0) return src;
  return src.slice(0, start) + src.slice(end + '\n          },'.length);
}

function insertEntry(spec) {
  let src = fs.readFileSync(ARTICLES, 'utf8');
  src = removeEntry(src, spec.id);

  const entry =
    '          {\n' +
    '            id: ' + jsStr(spec.id) + ',\n' +
    '            title: ' + jsStr(spec.title) + ',\n' +
    "            url: '../post/" + spec.id + '/' + spec.id + ".html',\n" +
    '            summary: ' + jsStr(spec.desc) + ',\n' +
    '            category: ' + jsStr(spec.category) + ',\n' +
    '            date: ' + jsStr(spec.date) + ',\n' +
    '            tags: [' + spec.tags.map(t => JSON.stringify(t)).join(',') + '],\n' +
    '          },\n';

  const anchor = 'window.articles = [\n';
  const i = src.indexOf(anchor);
  if (i < 0) fail('articles.js 里找不到 window.articles = [');
  src = src.slice(0, i + anchor.length) + entry + src.slice(i + anchor.length);

  const total = countEntries(src);
  fs.writeFileSync(ARTICLES, src);

  // home.html 的「共 N 篇」
  let home = fs.readFileSync(HOME_HTML, 'utf8');
  const homeRe = /(id="intro-counts"><span>共 )\d+( 篇)/;
  if (!homeRe.test(home)) console.warn('⚠ home.html 里没找到「共 N 篇」占位，跳过');
  home = home.replace(homeRe, '$1' + total + '$2');
  fs.writeFileSync(HOME_HTML, home);

  // index.html hero 的第一个 .num
  let idx = fs.readFileSync(INDEX_HTML, 'utf8');
  const heroAt = idx.indexOf('<div class="hero-stats">');
  if (heroAt < 0) {
    console.warn('⚠ index.html 里没找到 hero-stats，跳过');
  } else {
    const before = idx.slice(0, heroAt);
    const after = idx.slice(heroAt).replace(/<div class="num">\d+<\/div>/, '<div class="num">' + total + '</div>');
    idx = before + after;
    fs.writeFileSync(INDEX_HTML, idx);
  }

  return total;
}

function remember(spec) {
  if (!spec.source || !spec.source.key) return false;
  let data = { items: [] };
  if (fs.existsSync(SEEN)) {
    try {
      data = JSON.parse(fs.readFileSync(SEEN, 'utf8'));
    } catch (e) {
      console.warn('⚠ seen.json 解析失败，跳过入库');
      return false;
    }
  }
  if (!Array.isArray(data.items)) data.items = [];
  if (data.items.some(x => x.key === spec.source.key)) return false;
  data.items.push({ key: spec.source.key, since: spec.date || today() });
  fs.writeFileSync(SEEN, JSON.stringify(data, null, 1));
  return true;
}

function logDraft(spec) {
  let list = [];
  if (fs.existsSync(LEDGER)) {
    try {
      list = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    } catch (e) {
      list = [];
    }
  }
  if (!Array.isArray(list)) list = [];
  list = list.filter(x => x.id !== spec.id);
  list.push({
    id: spec.id,
    title: spec.title,
    category: spec.category,
    date: spec.date,
    source: spec.source || null,
    builtAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(list, null, 1));
}

/* ─────────── 主流程 ─────────── */

(async () => {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  if (!opts.spec) fail('缺少 --spec <file.json>');

  const spec = loadSpec(path.resolve(process.cwd(), opts.spec));
  const outDir = opts.out ? path.resolve(process.cwd(), opts.out) : path.join(ROOT, 'post', spec.id);
  fs.mkdirSync(outDir, { recursive: true });

  let cover = { ok: false, reason: '未启用 --cover' };
  if (flags.has('cover')) {
    cover = await makeCover(spec, path.join(outDir, 'cover.jpg'));
    console.log(cover.ok ? '✓ 封面 ' + (cover.size / 1024).toFixed(1) + ' KB' : '⚠ 封面跳过：' + cover.reason);
  } else if (fs.existsSync(path.join(outDir, 'cover.jpg'))) {
    cover = { ok: true, size: fs.statSync(path.join(outDir, 'cover.jpg')).size };
  }

  const html = render(spec, cover.ok);
  const file = path.join(outDir, spec.id + '.html');
  fs.writeFileSync(file, html, 'utf8');

  console.log('✓ HTML ' + path.relative(ROOT, file).replace(/\\/g, '/') + ' · ' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB');

  if (flags.has('index') && !opts.out) {
    const total = insertEntry(spec);
    console.log('✓ 索引已更新，全站 ' + total + ' 篇');
    logDraft(spec);
  }
  if (flags.has('remember')) {
    console.log(remember(spec) ? '✓ 来源已写入 seen.json' : '· seen.json 无变化（缺 source.key 或已存在）');
  }

  const words = spec.body.replace(/<[^>]+>/g, '').length;
  console.log('· 正文 ' + words + ' 字 · 分类「' + spec.category + '」· ' + spec.date);
})().catch(e => fail(e.message));
