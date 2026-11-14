#!/usr/bin/env node
/* ==========================================================================
   repo-lint.cjs — 仓库一致性检查
   检查 post/ 文章文件与前端页面显示的一致性
   使用: node scripts/repo-lint.cjs [--fix]
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ─────────── 工具函数 ─────────── */

function walk(dir, ext = '.html') {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) out = out.concat(walk(p, ext));
    else if (entry.endsWith(ext)) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

/* 从 home/articles.js 的 window.articles 数组提取对象数组（简化解析） */
function parseArticles(articlesJsContent) {
  // 定位 `window.articles = [`
  const m = articlesJsContent.match(/window\.articles\s*=\s*\[([\s\S]*?)\n\s*\](?=\s*[;,])/);
  if (!m) return [];
  const chunk = m[1];
  // 按 `,` 拆出每个对象（考虑花括号配对）
  const objects = [];
  let depth = 0, cur = '', inStr = false, strCh = '';
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (inStr) {
      cur += c;
      if (c === strCh && chunk[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; cur += c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      objects.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) objects.push(cur);

  return objects
    .map((o) => {
      const id = (o.match(/id\s*:\s*["']([^"']+)["']/) || [])[1];
      const title = (o.match(/title\s*:\s*["']([^"']+)["']/) || [])[1];
      const url = (o.match(/url\s*:\s*["']([^"']+)["']/) || [])[1];
      const category = (o.match(/category\s*:\s*["']([^"']+)["']/) || [])[1];
      return { id, title, url, category };
    })
    .filter((a) => a.id); // 过滤空对象
}

function extractDisplayNums(html) {
  const results = [];
  // home.html: "共 N 篇"
  const m1 = html.match(/共\s*(\d+)\s*篇/);
  if (m1) results.push({ location: 'home.html · "共 N 篇"', num: parseInt(m1[1]) });
  // index.html: articles hero
  const m2 = html.match(/(?:articles|内容库|内容总数)[\s\S]{0,60}?(\d+)/);
  if (m2) results.push({ location: 'index.html · hero articles', num: parseInt(m2[1]) });
  // index.html: hero 第一个 num div
  const m3 = html.match(/<div class="num">(\d+)<\/div>[\s\S]{0,60}articles/);
  if (m3) results.push({ location: 'index.html · hero first num', num: parseInt(m3[1]) });
  return results;
}

function printRow(label, value, pass) {
  const icon = pass === true ? '✅' : pass === false ? '❌' : pass === null ? '⏸' : 'ℹ';
  console.log(`  ${icon}  ${label.padEnd(36)}  ${value}`);
}

function printSection(title) {
  console.log(`\n━━━━━ ${title} ━━━━━`);
}

/* ─────────── 检查 1: 物理文件 vs articles 数组 ─────────── */

function checkPostCount() {
  printSection('文章数一致性');
  const postFiles = walk(path.join(ROOT, 'post'), '.html');
  const postCount = postFiles.length;

  const articlesJsPath = path.join(ROOT, 'home/articles.js');
  const articlesJsContent = fs.readFileSync(articlesJsPath, 'utf8');
  const articles = parseArticles(articlesJsContent);

  const homePath = path.join(ROOT, 'home/home.html');
  const homeHtml = fs.readFileSync(homePath, 'utf8');
  const displayMatch = homeHtml.match(/共\s*(\d+)\s*篇/);
  const displayNum = displayMatch ? parseInt(displayMatch[1]) : null;

  printRow('post/ 物理 html 文件数', postCount, true);
  printRow('articles.js articles 条目数', articles.length, true);
  printRow('home.html "共 N 篇" 显示', displayNum !== null ? displayNum : '未找到', true);

  let problems = [];
  if (postCount !== articles.length) {
    problems.push(`物理文件数 (${postCount}) ≠ articles 数组条目数 (${articles.length})`);
  }
  if (displayNum !== null && displayNum !== postCount) {
    problems.push(`显示数字 (${displayNum}) ≠ 实际文章数 (${postCount})`);
  }
  if (displayNum !== null && displayNum !== articles.length) {
    problems.push(`显示数字 (${displayNum}) ≠ articles 条目数 (${articles.length})`);
  }
  return { postCount, articles, displayNum, problems, homeHtml };
}

/* ─────────── 检查 2: 死链检测 ─────────── */

function checkDeadLinks(articles) {
  printSection('死链检测（articles → 物理文件）');
  const dead = [];
  for (const a of articles) {
    if (!a.url) continue;
    // articles 中写的是 "../post/xxx"（从 home/ 目录解析）
    const resolved = path.join(ROOT, 'home', a.url);
    if (!fs.existsSync(resolved)) {
      dead.push({ id: a.id, url: a.url });
    }
  }
  if (dead.length === 0) {
    console.log('  ✅  所有 articles 指向的 html 文件均存在');
  } else {
    for (const d of dead) {
      printRow(`死链 [${d.id}]`, d.url, false);
    }
  }
  return dead;
}

/* ─────────── 检查 3: 物理文件反查（存在但未在 articles 中） ─────────── */

function checkOrphanPosts(articles) {
  printSection('文章反查（有文件但没在 articles 里）');
  const articlePaths = new Set(articles.map((a) => {
    const p = path.join(ROOT, 'home', a.url);
    return rel(p);
  }));
  const postFiles = walk(path.join(ROOT, 'post'), '.html');
  const orphans = postFiles
    .map(rel)
    .filter((p) => !articlePaths.has(p));
  if (orphans.length === 0) {
    console.log('  ✅  所有 post/ 下的 html 文件都已在 articles 中列出');
  } else {
    for (const o of orphans) {
      printRow('未在 articles 中引用', o, false);
    }
  }
  return orphans;
}

/* ─────────── 检查 4: 重复 ID / 重复标题 ─────────── */

function checkDuplicates(articles) {
  printSection('重复检测');
  const byId = {};
  const byTitle = {};
  for (const a of articles) {
    (byId[a.id] = byId[a.id] || []).push(a);
    (byTitle[a.title] = byTitle[a.title] || []).push(a);
  }
  const dupIds = Object.entries(byId).filter(([, arr]) => arr.length > 1);
  const dupTitles = Object.entries(byTitle).filter(([, arr]) => arr.length > 1);
  if (dupIds.length === 0 && dupTitles.length === 0) {
    console.log('  ✅  无重复 ID，无重复标题');
    return { dupIds, dupTitles };
  }
  for (const [id, arr] of dupIds) {
    printRow(`重复 id [${id}]`, `共 ${arr.length} 条`, false);
  }
  for (const [title, arr] of dupTitles) {
    printRow(`重复标题 "${title}"`, `共 ${arr.length} 条 (可能是故意重复，人工确认)`, null);
  }
  return { dupIds, dupTitles };
}

/* ─────────── 检查 5: index.html hero 数字 ─────────── */

function checkIndexHero(postCount) {
  printSection('index.html hero 数字');
  const indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.log('  ⏸  未找到 index.html，跳过');
    return null;
  }
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  // 定位 hero-stats 标签后的第一个 <div class="num">N</div>
  const idx = indexHtml.indexOf('<div class="hero-stats">');
  if (idx === -1) {
    console.log('  ⏸  未找到 hero-stats 区块');
    return null;
  }
  const slice = indexHtml.substr(idx, 400);
  // 第一个 num div
  const m = slice.match(/<div class="num">(\d+)<\/div>/);
  if (!m) {
    console.log('  ⏸  hero-stats 中无数字，跳过');
    return null;
  }
  const heroNum = parseInt(m[1]);
  const pass = heroNum === postCount;
  printRow('index.html · hero articles', heroNum, pass);
  return { shouldBe: postCount, actual: heroNum };
}

/* ─────────── 检查 6: favicon 一致性 ─────────── */

function checkFaviconConsistency() {
  printSection('favicon 一致性');
  const htmlFiles = [
    ...walk(path.join(ROOT, 'post'), '.html'),
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'home/home.html'),
    path.join(ROOT, 'nav/index.html'),
    path.join(ROOT, 'skills/douyin-post-skill/template.html'),
  ].filter(fs.existsSync);
  let usesOldPng = 0;
  let usesSvg = 0;
  let others = 0;
  for (const f of htmlFiles) {
    const c = fs.readFileSync(f, 'utf8');
    if (/shortcut icon[^>]*50\.png/.test(c)) usesOldPng++;
    else if (/shortcut icon[^>]*logo\.svg/.test(c)) usesSvg++;
    else others++;
  }
  printRow('使用 logo.svg', `${usesSvg} 个文件`, true);
  if (usesOldPng > 0) printRow('仍使用 50.png (已弃)', `${usesOldPng} 个文件，需替换`, false);
  if (others > 0) printRow('其他 favicon', `${others} 个文件`, null);
  return { usesOldPng, usesSvg, others };
}

/* ─────────── 检查 7: 易读性样式覆盖率 ───────────
   共享样式 post/article-read.css 必须被每篇文章引用，否则新稿会退回
   文字墙排版。build-article.cjs 会自动带上，存量由 apply-read-css.cjs 补。 */
function checkReadCss() {
  printSection('易读性样式覆盖率');
  const files = walk(path.join(ROOT, 'post'), '.html');
  const missing = [];
  for (const f of files) {
    if (!/article-read\.css/.test(fs.readFileSync(f, 'utf8'))) missing.push(rel(f));
  }
  printRow('已接入 article-read.css', `${files.length - missing.length}/${files.length}`, missing.length === 0);
  for (const m of missing.slice(0, 10)) printRow('未接入', m, false);
  if (missing.length > 10) console.log(`  ℹ  另有 ${missing.length - 10} 个未接入`);
  if (missing.length === 0) console.log('  ✅  全部文章页已接入共享易读性样式');
  return missing;
}

/* ─────────── 检查 8: SEO 元数据覆盖率 ───────────
   canonical / og:image / twitter:card / JSON-LD 由 scripts/seo-meta.cjs 统一产出：
   新稿由 build-article.cjs 注入，存量由 apply-seo-meta.cjs 幂等补齐。
   顺带校验 JSON-LD 能解析、og:image 指向本站（防止带回退的站外签名图）。 */
function checkSeoMeta() {
  printSection('SEO 元数据覆盖率');
  const files = walk(path.join(ROOT, 'post'), '.html');
  const site = (process.env.SITE_URL || 'https://expectopatronus00.github.io').replace(/\/+$/, '');
  const issues = [];
  const ok = { canonical: 0, ogImage: 0, twitterCard: 0, jsonld: 0 };

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const at = src.search(/<\/head>/i);
    const head = at < 0 ? src : src.slice(0, at);
    const name = rel(f);
    const bad = (reason) => issues.push({ file: name, reason });

    if (/rel=["']canonical["']/i.test(head)) ok.canonical++;
    else bad('缺 canonical');

    const img = head.match(/<meta[^>]*property=["']og:image["'][^>]*>/i);
    if (img) {
      ok.ogImage++;
      const c = img[0].match(/content\s*=\s*["']([^"']+)["']/i);
      if (!c || c[1].indexOf(site + '/') !== 0) bad('og:image 不是本站地址');
    } else {
      bad('缺 og:image');
    }

    if (/name=["']twitter:card["']/i.test(head)) ok.twitterCard++;
    else bad('缺 twitter:card');

    const ld = head.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!ld) {
      bad('缺 JSON-LD');
    } else {
      try {
        const obj = JSON.parse(ld[1]);
        if (obj['@type'] !== 'BlogPosting' || !obj.headline || !obj.mainEntityOfPage ||
            !/^\d{4}-\d{2}-\d{2}$/.test(obj.datePublished || '')) {
          bad('JSON-LD 字段不全/缺日期');
        } else {
          ok.jsonld++;
        }
      } catch (e) {
        bad('JSON-LD 不是合法 JSON');
      }
    }
  }

  printRow('canonical', `${ok.canonical}/${files.length}`, ok.canonical === files.length);
  printRow('og:image（本站）', `${ok.ogImage}/${files.length}`, ok.ogImage === files.length);
  printRow('twitter:card', `${ok.twitterCard}/${files.length}`, ok.twitterCard === files.length);
  printRow('JSON-LD（可解析）', `${ok.jsonld}/${files.length}`, ok.jsonld === files.length);
  for (const i of issues.slice(0, 10)) printRow(i.reason, i.file, false);
  if (issues.length > 10) console.log(`  ℹ  另有 ${issues.length - 10} 项`);
  if (issues.length === 0) console.log('  ✅  全部文章页 SEO 元数据齐全');
  return issues;
}

/* ─────────── 检查 9: 站点基础设施 ─────────── */
function checkInfra() {
  printSection('站点基础设施');
  const issues = [];
  for (const name of ['robots.txt', '404.html', 'sitemap.xml', 'feed.xml']) {
    if (!fs.existsSync(path.join(ROOT, name))) issues.push(name + ' 缺失');
  }
  const robots = path.join(ROOT, 'robots.txt');
  if (fs.existsSync(robots) && !/^\s*Sitemap\s*:/im.test(fs.readFileSync(robots, 'utf8'))) {
    issues.push('robots.txt 未声明 Sitemap');
  }
  printRow('robots / 404 / sitemap / feed', issues.length === 0 ? '4/4 齐全' : issues.join('; '), issues.length === 0);

  /* feed 必须全量：条目数与 sitemap 里的文章 URL 数相等，且明显超过历史 30 条上限。
     两边同源，任一边被改回截断都会立刻对不上。 */
  const feedPath = path.join(ROOT, 'feed.xml');
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  if (fs.existsSync(feedPath) && fs.existsSync(sitemapPath)) {
    const feedItems = (fs.readFileSync(feedPath, 'utf8').match(/<item>/g) || []).length;
    const sitemapPosts = (fs.readFileSync(sitemapPath, 'utf8').match(/<loc>[^<]*\/post\//g) || []).length;
    const ok = feedItems === sitemapPosts && feedItems > 30;
    printRow('feed.xml 全量条目', feedItems + ' 条 · sitemap 文章 ' + sitemapPosts + ' 条', ok);
    if (!ok) {
      issues.push('feed.xml 未全量输出（' + feedItems + ' 条 / sitemap ' + sitemapPosts + ' 条）');
    }
  } else {
    issues.push('feed.xml 或 sitemap.xml 缺失，无法校验全量');
  }
  for (const i of issues) printRow('基础设施', i, false);
  return issues;
}

/* ─────────── 检查 10: 共享样式层 ─────────── */
const { hashOf, walkPosts, stylesOf, linksOf } = require('./shared-css.cjs');

function checkSharedCss() {
  printSection('共享样式层');
  const issues = [];
  const common = path.join(ROOT, 'post', 'article-common.css');
  const commonOk = fs.existsSync(common);
  if (!commonOk) issues.push('post/article-common.css 缺失');

  /* 重复内联 CSS 分组必须为 0：出现就说明有新稿或存量页把大段样式又抄回来了 */
  const groups = new Map();
  let inlineBlocks = 0;
  for (const f of walkPosts()) {
    const html = fs.readFileSync(f, 'utf8');
    for (const st of stylesOf(html)) {
      inlineBlocks++;
      groups.set(st.hash, (groups.get(st.hash) || 0) + 1);
    }
  }
  const repeats = [...groups.values()].filter((n) => n >= 2).length;
  if (repeats) issues.push('仍有 ' + repeats + ' 组重复内联 CSS，需跑 apply-shared-css.cjs');

  /* 每处 link 必须指向存在的文件，且文件内容 hash 与 data-shared-css 一致 */
  let links = 0, badLinks = 0;
  for (const f of walkPosts()) {
    const html = fs.readFileSync(f, 'utf8');
    for (const l of linksOf(html)) {
      links++;
      const target = path.resolve(path.dirname(f), l.href);
      if (!fs.existsSync(target)) {
        issues.push(rel(f) + ' → 共享 CSS 缺失 ' + rel(target));
        badLinks++;
        continue;
      }
      if (hashOf(fs.readFileSync(target, 'utf8')) !== l.hash) {
        issues.push(rel(f) + ' → ' + rel(target) + ' 内容 hash 不符');
        badLinks++;
      }
    }
  }
  printRow('post/article-common.css', commonOk ? '存在' : '缺失', commonOk);
  printRow('共享 CSS link（文件 + hash）', links + ' 处 · 异常 ' + badLinks, badLinks === 0);
  printRow('重复内联 CSS 分组', repeats === 0 ? '0 组（独有内联 ' + inlineBlocks + ' 处）' : repeats + ' 组', repeats === 0);
  if (repeats === 0 && badLinks === 0 && commonOk) console.log('  ✅  共享样式层完整，无重复内联 CSS');
  return issues;
}

/* ─────────── 检查 11: 首页静态兜底 ─────────── */
const { CONTAINERS, extractBlocks, renderBlocks, loadBlog } = require('./home-static.cjs');

function checkIndexStatic() {
  printSection('首页静态兜底');
  const issues = [];
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const actual = extractBlocks(html);
  let expected = null;
  try {
    expected = renderBlocks(loadBlog());
  } catch (e) {
    issues.push('无法从 articles.js 生成静态块：' + e.message);
  }
  let stale = 0, missing = 0;
  for (const id of CONTAINERS) {
    if (actual[id] === null) { missing++; issues.push('#' + id + ' 缺静态兜底标记'); }
    else if (expected && actual[id] !== expected[id]) {
      stale++;
      issues.push('#' + id + ' 静态兜底已过期，需跑 node scripts/build-index.cjs');
    }
  }
  const deferred = /<script src="home\/articles\.js" defer><\/script>/.test(html);
  const wrapped = /document\.addEventListener\('DOMContentLoaded'/.test(html);
  if (!deferred) issues.push('home/articles.js 未使用 defer');
  if (!wrapped) issues.push('首页渲染脚本未包进 DOMContentLoaded（defer 后会拿不到 BLOG）');

  printRow('四个容器静态兜底', (CONTAINERS.length - missing - stale) + '/' + CONTAINERS.length + ' 最新', missing + stale === 0);
  printRow('defer + DOMContentLoaded', deferred && wrapped ? '已就位' : '缺失', deferred && wrapped);
  if (issues.length === 0) console.log('  ✅  首页禁用 JS 也能看到最新内容');
  return issues;
}

/* ─────────── 检查 12: 图片属性与封面双格式 ─────────── */
const { walkCovers, pendingList } = require('./cover-webp.cjs');
/* 与修复脚本共用「本地图片」判定，避免 lint 把空 src 解析出的目录误计成图片 */
const { resolveLocal, EMPTY_SRC_IMG } = require('./apply-image-attrs.cjs');

function checkImages() {
  printSection('图片属性与封面双格式');
  const issues = [];
  const covers = walkCovers();
  const missingWebp = pendingList();
  for (const f of missingWebp) issues.push(rel(f) + ' 缺/过期 cover.webp');

  let imgTotal = 0, localTotal = 0, sized = 0, decoded = 0, ready = 0, emptySrc = 0;
  for (const f of walk(ROOT, '.html')) {
    if (rel(f).startsWith('.tools/')) continue;
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      imgTotal++;
      if (/\bdecoding\s*=/i.test(tag)) decoded++;
      else issues.push(rel(f) + ' 有 img 缺 decoding');
      const src = (tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      if (EMPTY_SRC_IMG.test(tag)) {
        emptySrc++;
        issues.push(rel(f) + ' 有 src 为空的 img（会渲染成破图）');
        continue;
      }
      const local = resolveLocal(f, src);
      if (local) {
        localTotal++;
        if (/\bwidth\s*=/i.test(tag) && /\bheight\s*=/i.test(tag)) sized++;
        else issues.push(rel(f) + ' 本地图片 ' + src + ' 缺 width/height');
      }
      if (/cover\.jpg/i.test(src) && /data-cover-ready/i.test(tag)) ready++;
    }
  }
  const coversReady = covers.length - missingWebp.length;
  printRow('cover.webp 伴生', coversReady + '/' + covers.length, missingWebp.length === 0);
  printRow('本地图片 width/height', sized + '/' + localTotal, sized === localTotal);
  printRow('img decoding="async"', decoded + '/' + imgTotal, decoded === imgTotal);
  printRow('封面 picture 升级', ready + '/' + covers.length, ready === covers.length);
  printRow('无空 src 破图', emptySrc === 0 ? '0 处' : emptySrc + ' 处', emptySrc === 0);
  if (issues.length === 0) console.log('  ✅  封面双格式与图片属性齐全');
  return issues;
}

/* ─────────── 检查 13: head 提示层 ─────────── */
const {
  BEGIN: HH_BEGIN, FONT_ORIGIN, FONT_CSS, FA_ORIGIN, THEME_SCRIPT,
  cssBg, walkPages, readHints, needsFa, needsFontCss, stripHints: stripHeadHints,
} = require('./head-hints.cjs');

function checkHeadHints() {
  printSection('head 提示层（theme-color / preconnect）');
  const issues = [];
  const { dark, cssFound } = cssBg(ROOT);
  if (!cssFound) issues.push('design-tokens.css 里解析不到 --ink-950 / --paper');
  if (!fs.existsSync(path.join(ROOT, 'home', 'theme-color.js'))) {
    issues.push('home/theme-color.js 缺失');
  }
  /* emfont CSS 必须是 head 里的独立 link：留在 fonts.css 的 @import
     会重新引入「先下载 fonts.css 才能发起字体请求」的串行链。 */
  const fontsCss = fs.readFileSync(path.join(ROOT, 'home', 'fonts.css'), 'utf8');
  /* 先剥掉注释：说明文字里会提到 @import 这个词，全文匹配会误报。 */
  const fontsCssCode = fontsCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const noImport = !/@import\b/i.test(fontsCssCode);
  if (!noImport) issues.push('home/fonts.css 仍有 @import（字体请求会串行）');

  const pages = walkPages(ROOT);
  let blocks = 0, metaOk = 0, preOk = 0, scriptOk = 0, faTotal = 0, faOk = 0;
  let fontTotal = 0, fontOk = 0;
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const block = readHints(html);
    if (!block) {
      issues.push(rel(f) + ' 缺 head hints 块');
      continue;
    }
    blocks++;
    const headEnd = html.toLowerCase().indexOf('</head>');
    if (headEnd < 0 || html.indexOf(HH_BEGIN) > headEnd) {
      issues.push(rel(f) + ' hints 块不在 head 内');
    }
    if (block.includes('<meta name="theme-color" content="' + dark + '"')) metaOk++;
    else issues.push(rel(f) + ' theme-color 与 CSS 主题底色不一致');
    if (block.includes('rel="preconnect" href="' + FONT_ORIGIN + '"')) preOk++;
    else issues.push(rel(f) + ' 缺 font.emtech.cc preconnect');
    if (block.includes('src="' + THEME_SCRIPT + '" defer')) scriptOk++;
    else issues.push(rel(f) + ' 缺主题同步脚本');
    if (needsFa(html)) {
      faTotal++;
      if (block.includes('rel="preconnect" href="' + FA_ORIGIN + '"')) faOk++;
      else issues.push(rel(f) + ' 外链 FontAwesome 却缺 cdnjs preconnect');
    }
    /* strip 掉 hints 再判断，避免用块内自己注入的 link 自证。 */
    const wantsFont = needsFontCss(stripHeadHints(html));
    const hasFontLink = block.includes('rel="stylesheet" href="' + FONT_CSS + '"');
    if (wantsFont) {
      fontTotal++;
      if (hasFontLink) fontOk++;
      else issues.push(rel(f) + ' 引用 fonts.css 却缺并行 emfont 样式表');
    } else if (hasFontLink) {
      issues.push(rel(f) + ' 不加载字体却外链了 emfont 样式表');
    }
  }
  const all = pages.length;
  printRow('hints 块（head 内）', blocks + '/' + all, blocks === all);
  printRow('theme-color 与 CSS 一致', metaOk + '/' + all, metaOk === all);
  printRow('font CDN preconnect', preOk + '/' + all, preOk === all);
  printRow('主题同步脚本', scriptOk + '/' + all, scriptOk === all);
  printRow('FontAwesome preconnect', faOk + '/' + faTotal, faOk === faTotal);
  printRow('emfont CSS 并行加载', fontOk + '/' + fontTotal, fontOk === fontTotal && noImport);
  printRow('fonts.css 无 @import', noImport ? '已移除' : '仍存在', noImport);
  return issues;
}

/* ─────────── 检查 14: 语义结构 ─────────── */
function checkSemantics() {
  printSection('语义结构');
  const issues = [];
  const pages = walkPages(ROOT);
  let one = 0;
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const n = (html.match(/<h1\b/gi) || []).length;
    if (n === 1) one++;
    else issues.push(rel(f) + ' 有 ' + n + ' 个 h1（应为 1）');
  }
  printRow('每页恰好 1 个 h1', one + '/' + pages.length, one === pages.length);
  return issues;
}

/* ─────────── 检查 15: 静态页 SEO ───────────
   文章页按目录扫描，静态页按 site-meta.cjs 的白名单逐页校验。
   额外做两件事：canonical 必须在 sitemap 的 <loc> 里（防止两处漂移），
   noindex 页必须仍然 noindex（防止误注入把 404 变成可索引页面）。 */
const { PAGES, NOINDEX_PAGES, fileOf, DEFAULT_IMAGE } = require('./site-meta.cjs');
const { siteUrl, BEGIN: SEO_BEGIN, END: SEO_END } = require('./seo-meta.cjs');

function checkSiteMeta() {
  printSection('静态页 SEO 元数据');
  const issues = [];
  const site = siteUrl();
  const sitemap = fs.existsSync(path.join(ROOT, 'sitemap.xml'))
    ? fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8')
    : '';
  const locs = new Set([...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]));
  let blockOk = 0, canonicalOk = 0, ogOk = 0, ldOk = 0;

  for (const page of PAGES) {
    const f = fileOf(page);
    const name = page.file;
    if (!fs.existsSync(f)) { issues.push(name + ' 缺失'); continue; }
    const html = fs.readFileSync(f, 'utf8');
    const at = html.search(/<\/head>/i);
    const head = at < 0 ? html : html.slice(0, at);
    const wantUrl = site + page.path;

    if (head.includes(SEO_BEGIN) && head.includes(SEO_END)) blockOk++;
    else issues.push(name + ' 缺 seo 块');

    const cm = head.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    if (cm && cm[1] === wantUrl && locs.has(wantUrl)) canonicalOk++;
    else issues.push(name + ' canonical 与 sitemap 不一致：' + (cm ? cm[1] : '缺失'));

    const type = (head.match(/<meta[^>]*property=["']og:type["'][^>]*content=["']([^"']+)["']/i) || [])[1];
    const img = (head.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1];
    const tw = /<meta[^>]*name=["']twitter:card["']/i.test(head);
    if (type === 'website' && img === site + DEFAULT_IMAGE && tw) ogOk++;
    else issues.push(name + ' og:type / og:image / twitter:card 不齐');

    const ld = head.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!ld) { issues.push(name + ' 缺 JSON-LD'); continue; }
    try {
      const o = JSON.parse(ld[1]);
      if (o['@type'] === page.schemaType &&
          o.mainEntityOfPage && o.mainEntityOfPage['@id'] === wantUrl &&
          !o.datePublished && o.headline) ldOk++;
      else issues.push(name + ' JSON-LD 类型/字段不对');
    } catch (e) {
      issues.push(name + ' JSON-LD 不是合法 JSON');
    }
  }

  const n = PAGES.length;
  printRow('seo 块', blockOk + '/' + n, blockOk === n);
  printRow('canonical 对齐 sitemap', canonicalOk + '/' + n, canonicalOk === n);
  printRow('og:type / og:image / twitter', ogOk + '/' + n, ogOk === n);
  printRow('JSON-LD（静态页类型）', ldOk + '/' + n, ldOk === n);

  let noindexOk = 0;
  for (const name of NOINDEX_PAGES) {
    const f = path.join(ROOT, name);
    const src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const at = src.search(/<\/head>/i);
    const head = at < 0 ? src : src.slice(0, at);
    if (/<meta[^>]*name=["']robots["'][^>]*noindex/i.test(head)) noindexOk++;
    else issues.push(name + ' 丢了 noindex');
  }
  printRow('noindex 页保持不索引', noindexOk + '/' + NOINDEX_PAGES.length, noindexOk === NOINDEX_PAGES.length);
  return issues;
}

/* ─────────── 检查 16: skip-link（WCAG 2.4.1） ───────────
   不只看「有没有这个链接」：还要确认目标 id 唯一、锚点真的落在导航之后
   的主内容容器上、目标可程序聚焦，以及共享样式层里有可见的聚焦态。 */
const {
  BEGIN: SKIP_BEGIN, TARGET_ID, MARK, readSkip, anchorTag,
} = require('./skip-link.cjs');

function checkSkipLink() {
  printSection('跳到主要内容（WCAG 2.4.1）');
  const issues = [];
  const css = fs.readFileSync(path.join(ROOT, 'home', 'design-tokens.css'), 'utf8');
  const cssOk = /html body a\.skip-link\s*\{/.test(css) &&
    /html body a\.skip-link:focus/.test(css);
  if (!cssOk) issues.push('design-tokens.css 缺 skip-link 聚焦样式');

  const pages = walkPages(ROOT);
  let blocks = 0, links = 0, ids = 0, targets = 0;
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const name = rel(f);
    const block = readSkip(html);
    if (!block) { issues.push(name + ' 缺 skip-link 块'); continue; }
    blocks++;

    const bodyAt = html.search(/<body\b[^>]*>/i);
    if (bodyAt < 0 || html.indexOf(SKIP_BEGIN) < bodyAt) {
      issues.push(name + ' skip-link 不在 body 开头');
    }
    if (block.includes('href="#' + TARGET_ID + '"')) links++;
    else issues.push(name + ' skip-link 指向不对');

    const idCount = (html.match(new RegExp('\\bid=["\']' + TARGET_ID + '["\']', 'gi')) || []).length;
    if (idCount === 1) ids++;
    else issues.push(name + ' 有 ' + idCount + ' 个 #' + TARGET_ID + '（应为 1）');

    const a = anchorTag(html);
    if (!a) { issues.push(name + ' 找不到主内容锚点'); continue; }
    if (a.tag.includes(MARK) && a.tag.includes('tabindex="-1"') &&
        new RegExp('\\bid=["\']' + TARGET_ID + '["\']', 'i').test(a.tag)) targets++;
    else issues.push(name + ' 主内容容器缺 id / tabindex / 标记');
  }

  const n = pages.length;
  printRow('skip-link 块', blocks + '/' + n, blocks === n);
  printRow('指向 #' + TARGET_ID, links + '/' + n, links === n);
  printRow('目标 id 唯一', ids + '/' + n, ids === n);
  printRow('锚点落在主内容上', targets + '/' + n, targets === n);
  printRow('聚焦可见样式', cssOk ? '已就位' : '缺失', cssOk);
  return issues;
}

/* ─────────── 主流程 ─────────── */

function main() {
  const args = process.argv.slice(2);
  const doFix = args.includes('--fix');

  console.log('─────────────────────────────────────────');
  console.log('  repo-lint · 仓库一致性检查');
  console.log(`  工作目录: ${ROOT}`);
  console.log('─────────────────────────────────────────');

  const { postCount, articles, displayNum, homeHtml } = checkPostCount();
  const deadLinks = checkDeadLinks(articles);
  const orphans = checkOrphanPosts(articles);
  const { dupIds, dupTitles } = checkDuplicates(articles);
  const heroStatus = checkIndexHero(postCount);
  const favStatus = checkFaviconConsistency();
  const missingReadCss = checkReadCss();
  const seoIssues = checkSeoMeta();
  const infraIssues = checkInfra();
  const sharedCssIssues = checkSharedCss();
  const indexStaticIssues = checkIndexStatic();
  const imageIssues = checkImages();
  const headHintsIssues = checkHeadHints();
  const semanticIssues = checkSemantics();
  const siteMetaIssues = checkSiteMeta();
  const skipLinkIssues = checkSkipLink();

  console.log('\n━━━━━ 总览 ━━━━━');
  const issueCount =
    deadLinks.length + orphans.length + dupIds.length + missingReadCss.length +
    seoIssues.length + infraIssues.length + sharedCssIssues.length + indexStaticIssues.length + imageIssues.length +
    headHintsIssues.length + semanticIssues.length + siteMetaIssues.length + skipLinkIssues.length +
    (displayNum !== null && displayNum !== postCount ? 1 : 0) +
    (postCount !== articles.length ? 1 : 0) +
    (heroStatus && heroStatus.actual !== heroStatus.shouldBe ? 1 : 0) +
    (favStatus.usesOldPng > 0 ? 1 : 0);

  if (issueCount === 0) {
    console.log('  ✅  全部通过，仓库状态干净');
  } else {
    console.log(`  ⚠ 发现 ${issueCount} 项问题，建议处理后推送`);
  }
  console.log('');

  // ── 可选自动修复：更新 home.html 显示数字 + index.html hero 数字 ──
  if (doFix) {
    let fixed = false;
    // 修复 home.html "共 N 篇"
    if (displayNum !== null && displayNum !== postCount) {
      const newHome = homeHtml.replace(/共\s*\d+\s*篇/, `共 ${postCount} 篇`);
      fs.writeFileSync(path.join(ROOT, 'home/home.html'), newHome);
      console.log(`  🔧  已修复 home.html "共 N 篇"：${displayNum} → ${postCount}`);
      fixed = true;
    }
    // 修复 index.html hero 第一个 num
    const indexPath = path.join(ROOT, 'index.html');
    if (heroStatus && heroStatus.actual !== heroStatus.shouldBe && fs.existsSync(indexPath)) {
      const indexHtml = fs.readFileSync(indexPath, 'utf8');
      const newIndex = indexHtml.replace(
        /(<div class="hero-stats">[\s\S]*?<div class="num">)(\d+)(<\/div>)/,
        `$1${postCount}$3`,
      );
      fs.writeFileSync(indexPath, newIndex);
      console.log(`  🔧  已修复 index.html hero articles 数字：${heroStatus.actual} → ${postCount}`);
      fixed = true;
    }
    if (!fixed) console.log('  ℹ  --fix 无可自动修复的内容');
  } else if (issueCount > 0) {
    console.log('  💡 提示: 可加 --fix 自动修复显示数字（显示数字与物理文件数不符时）');
  }

  process.exit(issueCount === 0 ? 0 : 1);
}

main();
