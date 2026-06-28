#!/usr/bin/env node
// 快速微信文章抓取 + 生成
// 用法: node scripts/wx-post-quick.cjs <url>
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL = process.argv[2];
if (!URL) {
  console.error('需要一个 URL 参数');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const HOME_PATH = path.join(ROOT, 'home', 'home.html');
const INDEX_PATH = path.join(ROOT, 'index.html');
const ARTICLES_JS_PATH = path.join(ROOT, 'home', 'articles.js');

// ============== 抓取 ==============
console.log('📡 抓取:', URL);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
let html = '';
try {
  const tmp = path.join(os.tmpdir(), 'wx-' + process.pid + '.html');
  execSync(`curl -sSL --max-time 30 -A "${UA}" -H "Accept-Language: zh-CN,zh;q=0.9" -o "${tmp}" "${URL}"`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  html = fs.readFileSync(tmp, 'utf-8');
} catch (e) {
  console.error('curl 失败:', e.message);
  process.exit(1);
}

if (!html || html.length < 500) {
  console.error('HTML 内容过短，可能被反爬。长度:', html?.length);
  process.exit(1);
}
console.log('✅ 抓取成功，HTML 长度:', html.length);

// ============== 解析元数据 ==============
function extract(pattern, alt = '') {
  const m = html.match(pattern);
  return m ? m[1] : alt;
}

let title = '';
let titleMatch = html.match(/<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)<\/h1>/);
if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
if (!title) title = extract(/<title>([^<]*)</) || '';
title = title.replace(/\s+/g, ' ').trim();
console.log('📝 标题:', title);

let author = '';
const authorMatch = html.match(/id="js_name"[^>]*>([^<]*)/);
if (authorMatch) author = authorMatch[1].trim();
if (!author) {
  const ogAuthor = html.match(/meta\s+property="article:author"\s+content="([^"]+)"/);
  if (ogAuthor) author = ogAuthor[1];
}
console.log('✍️  作者:', author || '(未知)');

let date = '';
const dateMatch = html.match(/em[^>]*id="publish_time"[^>]*>([^<]*)</);
if (dateMatch) date = dateMatch[1].trim();
if (!date) {
  const ogDate = html.match(/meta\s+property="article:published_time"\s+content="([0-9\-]+)/);
  if (ogDate) date = ogDate[1];
}
if (!date) date = '2026-06-20';
date = date.slice(0, 10);
console.log('📅 日期:', date);

let cover = '';
const ogImg = html.match(/meta\s+(property|name)="og:image"\s+content="([^"]+)"/);
if (ogImg) cover = ogImg[2];
if (!cover) {
  const firstImg = html.match(/<img[^>]*data-src="([^"]+)"/);
  if (firstImg) cover = firstImg[1];
}
console.log('🖼️  封面:', cover ? cover.slice(0, 60) + '...' : '(无)');

let metaDesc = '';
const descMatch = html.match(/meta\s+name="description"\s+content="([^"]+)"/);
if (descMatch) metaDesc = descMatch[1];

// ============== 解析正文 ==============
let bodyHtml = '';
let bodyMatch = html.match(/id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*id="js_sg_bar"/);
if (!bodyMatch) {
  bodyMatch = html.match(/class="rich_media_content"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="rich_media_area_extra"/);
}
if (!bodyMatch) {
  // 更宽泛的匹配
  bodyMatch = html.match(/class="rich_media_content"[^>]*>([\s\S]*?)<\/div>\s*(<div|<script|<\/body)/);
}
if (bodyMatch) bodyHtml = bodyMatch[1];
if (!bodyHtml || bodyHtml.length < 200) {
  // 兜底：在整个 HTML 中搜索 <p> 的段落
  const paras = html.match(/<p[^>]*>[\s\S]*?<\/p>/g) || [];
  bodyHtml = paras.join('\n');
  console.log('⚠️  使用兜底段落匹配，段落数:', paras.length);
}
console.log('📄 正文 HTML 长度:', bodyHtml.length);

// ============== 内容结构化（章节识别）==============
// 清理正文：过滤空段落，保留 h2/h3/section/p/img 等结构化内容
let cleanBlocks = [];
const blockMatch = bodyHtml.match(/<(h[1-6]|p|section|blockquote|div)[^>]*>([\s\S]*?)<\/\1>/gi) || [];
for (let b of blockMatch) {
  const tagMatch = b.match(/^<(h[1-6]|p|section|blockquote|div)\b/i);
  if (!tagMatch) continue;
  const tag = tagMatch[1].toLowerCase();
  const text = b
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .trim();
  if (!text || text.length < 4) continue;
  cleanBlocks.push({ tag, text });
}
console.log('🧩 可用段落数:', cleanBlocks.length);

// 识别标题和章节
const blocks = cleanBlocks.map(b => {
  const plain = b.text.replace(/\s+/g, ' ');
  let tag = b.tag;
  if ((tag === 'p' || tag === 'div') && plain.length < 50) {
    // 短段检查：是否像标题？
    if (/^第[\u4e00-\u9fa50-9]+[章回节篇篇]/.test(plain)) tag = 'h2';
    else if (/^[一二三四五六七八九十][、\.]/.test(plain)) tag = 'h2';
    else if (/^[\d]{1,3}[\.、][^\d]/.test(plain)) tag = 'h2';
    else if (/^[\d]{1,2}[\.][\d]{1,2}[\.、\s]/.test(plain)) tag = 'h3';
    else if (/^[\(（][\d一二三四五六七八九十]+[\)）]/.test(plain)) tag = 'h3';
  }
  return { tag, text: plain };
});

// 构建章节结构：每当遇到 h1/h2/h3 时开新章节
const sections = [];
let currentSec = { title: '', paragraphs: [] };
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (b.tag === 'h2' || b.tag === 'h1') {
    if (currentSec.title || currentSec.paragraphs.length) sections.push(currentSec);
    currentSec = { title: b.text, paragraphs: [] };
  } else if (b.tag === 'h3') {
    currentSec.paragraphs.push({ type: 'h3', text: b.text });
  } else {
    currentSec.paragraphs.push({ type: 'p', text: b.text });
  }
}
if (currentSec.title || currentSec.paragraphs.length) sections.push(currentSec);
console.log('🗂️  章节数:', sections.length);

// 如果没有章节标题，从第一段作为导读
if (sections.length > 0 && !sections[0].title && sections[0].paragraphs.length > 0) {
  const first = sections[0].paragraphs.shift();
  sections.unshift({ title: '导读', paragraphs: [first] });
}

// 构建 summary（取第一段非标题）
let summary = '';
for (const s of sections) {
  for (const p of s.paragraphs) {
    if (typeof p === 'string') { if (p.length > 30) { summary = p; break; } }
    else if (p.type === 'p' && p.text.length > 30) { summary = p.text; break; }
  }
  if (summary) break;
}
if (metaDesc && metaDesc.length > summary.length) summary = metaDesc;
summary = summary.replace(/\s+/g, ' ').slice(0, 160);
console.log('💬 摘要:', summary);

// ============== slug 派生 ==============
let slug = '';
const ascii = (title || '').replace(/[\u4e00-\u9fa5]/g, '').replace(/[^\w\-]+/g, ' ').trim().toLowerCase();
const words = ascii.split(/\s+/).filter(Boolean).slice(0, 4);
if (words.length >= 2) slug = words.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
if (!slug || slug.length < 4) {
  const hash = Math.abs(Buffer.from(URL).toString().split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(36).slice(0, 6);
  slug = 'post-' + date + '-' + hash;
}
// 去重
let finalSlug = slug;
let i = 2;
while (fs.existsSync(path.join(ROOT, 'post', finalSlug))) {
  finalSlug = slug + '-' + i;
  i++;
}
slug = finalSlug;
console.log('📂 slug:', slug);

// ============== 生成文章 HTML ==============
const bodyOut = [];
for (let si = 0; si < sections.length; si++) {
  const s = sections[si];
  if (s.title) bodyOut.push('      <div class="section-marker on-scroll">' + String(si).padStart(2, '0') + ' · ' + escapeHtml(s.title) + '</div>');
  if (s.title) bodyOut.push('      <h2 class="on-scroll">' + escapeHtml(s.title) + '</h2>');
  for (const p of s.paragraphs) {
    const txt = typeof p === 'string' ? p : p.text;
    const tp = typeof p === 'string' ? 'p' : p.type;
    if (tp === 'h3') {
      bodyOut.push('      <h3 class="on-scroll">' + escapeHtml(txt) + '</h3>');
    } else if (/^[\d一二三四五六七八九十][\.、]/.test(txt) && txt.length < 180) {
      bodyOut.push('      <div class="info-box on-scroll">' + escapeHtml(txt) + '</div>');
    } else if (/^(据|根据|以下|例如|注：|以下内容)/.test(txt) && txt.length < 260) {
      bodyOut.push('      <div class="pull-quote on-scroll"><p>' + escapeHtml(txt) + '</p></div>');
    } else {
      bodyOut.push('      <p class="on-scroll">' + escapeHtml(txt) + '</p>');
    }
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const articleHtml = buildArticleTemplate({
  slug, title, author, date, cover, summary,
  content: bodyOut.join('\n'),
});

// 写入文件
const outDir = path.join(ROOT, 'post', slug);
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, slug + '.html');
fs.writeFileSync(outPath, articleHtml, 'utf-8');
console.log('✅ 生成文章:', outPath);

// ============== 更新 home/articles.js ==============
let articlesJs = fs.readFileSync(ARTICLES_JS_PATH, 'utf-8');
const articlesAnchorIdx = articlesJs.indexOf('window.articles = [');
if (articlesAnchorIdx >= 0) {
  const afterBracket = articlesJs.indexOf('\n', articlesAnchorIdx + 'window.articles = ['.length);
  const newEntry =
    '          {\n' +
    '            id: \'' + slug + '\',\n' +
    '            title: \'' + escapeJs(title) + '\',\n' +
    '            url: \'../post/' + slug + '/' + slug + '.html\',\n' +
    '            summary: \'' + escapeJs(summary) + '\',\n' +
    '            category: \'微信搬运\',\n' +
    '            date: \'' + date + '\',\n' +
    '            tags: [\'AI\',\'大模型\',\'技术\'],\n' +
    '          },\n';
  articlesJs = articlesJs.slice(0, afterBracket + 1) + newEntry + articlesJs.slice(afterBracket + 1);
  fs.writeFileSync(ARTICLES_JS_PATH, articlesJs, 'utf-8');
  console.log('✅ 更新 home/articles.js');
} else {
  console.error('❌ articles.js 未找到 window.articles = [');
}

// ============== 更新 home.html (统计数字) ==============
let homeHtml = fs.readFileSync(HOME_PATH, 'utf-8');
homeHtml = homeHtml.replace(/共 (\d+) 篇/, (m, n) => '共 ' + (parseInt(n) + 1) + ' 篇');
fs.writeFileSync(HOME_PATH, homeHtml, 'utf-8');
console.log('✅ 更新 home.html (共 N 篇)');

// ============== 更新 index.html (hero 数字) ==============
let indexHtml = fs.readFileSync(INDEX_PATH, 'utf-8');
// hero 数字
indexHtml = indexHtml.replace(/(<div class="num">)(\d+)(<\/div>)/, function(m, pre, n, post) {
  return pre + (parseInt(n) + 1) + post;
});
fs.writeFileSync(INDEX_PATH, indexHtml, 'utf-8');
console.log('✅ 更新 index.html (hero 数字；latest-grid 由前端 JS 动态渲染)');

function escapeJs(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n');
}

function buildArticleTemplate(opts) {
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(opts.title)} · EXPECTOPATRONUS</title>
    <meta name="description" content="${escapeHtml(opts.summary)}" />
    <meta name="keywords" content="AI,大模型,技术,深度分析" />
    <meta property="og:title" content="${escapeHtml(opts.title)}" />
    <meta property="og:type" content="article" />
    <meta property="og:description" content="${escapeHtml(opts.summary)}" />
    <link rel="shortcut icon" href="../../home/logo.svg" type="image/svg+xml" />
    <script>
      (function () {
        try { var t = localStorage.getItem('theme') || 'dark'; if (t === 'light') document.documentElement.dataset.theme = 'light'; } catch (e) {}
      })();
    </script>
    <link rel="stylesheet" href="../../home/design-tokens.css" />
    <style>
      .icon { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; vertical-align: -0.125em; color: currentColor; flex-shrink: 0; }
      .icon svg { width: 100%; height: 100%; }
      .icon-sm { width: 0.82em; height: 0.82em; }
      .icon-lg { width: 1.3em; height: 1.3em; }
      .theme-icon { color: var(--accent-rust); }

      body {
        font-family: var(--font-serif);
        background: var(--bg-0);
        color: var(--text);
        line-height: 1.8;
        margin: 0;
        font-size: 1.05rem;
      }

      /* 顶部导航 */
      nav.site-nav {
        position: sticky; top: 0; z-index: 100;
        display: flex; align-items: center; justify-content: space-between;
        padding: var(--sp-4) var(--sp-6);
        background: rgba(10, 12, 15, 0.85);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--line);
        font-family: var(--font-mono);
      }
      nav.site-nav .brand { display: flex; align-items: center; gap: var(--sp-2); color: var(--text); font-weight: 600; text-decoration: none; }
      nav.site-nav .brand .logo {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 8px;
        background: var(--accent-rust); color: #fff; font-weight: 700; font-family: var(--font-display);
      }
      nav.site-nav .nav-links { display: flex; gap: var(--sp-5); align-items: center; }
      nav.site-nav .nav-links a { color: var(--text-soft); text-decoration: none; font-size: 0.92rem; }
      nav.site-nav .nav-links a:hover { color: var(--accent-rust); }
      nav.site-nav .nav-links a.is-active { color: var(--accent-rust); }
      .theme-btn {
        background: transparent; border: 1px solid var(--line); color: var(--text-soft);
        padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 0.85rem;
        transition: all 0.2s;
      }
      .theme-btn:hover { border-color: var(--accent-rust); color: var(--accent-rust); }

      /* 页面 hero */
      section.page-head {
        max-width: var(--container, 960px);
        margin: 0 auto;
        padding: var(--sp-10) var(--sp-6) var(--sp-6);
        border-bottom: 1px solid var(--line);
      }
      section.page-head .eyebrow {
        font-family: var(--font-mono); font-size: 0.8rem;
        color: var(--accent-rust); letter-spacing: 0.12em;
        text-transform: uppercase; margin-bottom: var(--sp-4);
      }
      section.page-head h1 {
        font-family: var(--font-display); font-weight: 500;
        font-size: clamp(1.8rem, 4vw, 2.8rem); line-height: 1.15;
        letter-spacing: -0.01em; margin: 0 0 var(--sp-4);
      }
      section.page-head > p { color: var(--text-soft); font-size: 1.1rem; max-width: 680px; }
      section.page-head .meta {
        display: flex; flex-wrap: wrap; gap: var(--sp-4);
        margin-top: var(--sp-5); font-family: var(--font-mono); font-size: 0.85rem;
        color: var(--text-dim);
      }
      section.page-head .meta span { display: inline-flex; align-items: center; gap: 6px; }
      section.page-head .meta svg { color: var(--accent-rust); }

      .hero-image {
        max-width: var(--container, 960px); margin: var(--sp-6) auto 0;
        padding: 0 var(--sp-6);
      }
      .hero-image img {
        width: 100%; border-radius: var(--r-lg, 16px); display: block;
        border: 1px solid var(--line);
      }

      /* 正文 */
      article.article-body {
        max-width: 760px;
        margin: 0 auto;
        padding: var(--sp-8) var(--sp-6) var(--sp-10);
      }
      article.article-body h2 {
        font-family: var(--font-display); font-weight: 500;
        font-size: 1.55rem; margin: var(--sp-8) 0 var(--sp-4);
        color: var(--text);
      }
      article.article-body h3 {
        font-family: var(--font-display); font-weight: 500;
        font-size: 1.15rem; margin: var(--sp-6) 0 var(--sp-3);
        color: var(--text);
      }
      article.article-body p {
        font-family: var(--font-serif); color: var(--text-soft);
        line-height: 1.9; margin: 0 0 var(--sp-4);
      }
      article.article-body p strong { color: var(--text); font-weight: 600; }
      article.article-body .hl {
        background: linear-gradient(transparent 60%, rgba(200, 120, 80, 0.35) 60%);
        padding: 0 3px; border-radius: 2px; color: var(--text);
      }

      .section-marker {
        font-family: var(--font-mono); font-size: 0.78rem;
        color: var(--accent-rust); letter-spacing: 0.08em;
        margin-top: var(--sp-8); margin-bottom: var(--sp-2);
      }

      .info-box {
        border-left: 3px solid var(--accent-rust);
        padding: var(--sp-3) var(--sp-4);
        margin: var(--sp-4) 0;
        background: rgba(200, 120, 80, 0.08);
        border-radius: 0 var(--r-md) var(--r-md) 0;
        color: var(--text-soft);
      }
      .info-box.info-box-jade {
        border-left-color: var(--accent-jade, #4a9b8a);
        background: rgba(74, 155, 138, 0.08);
      }
      .info-box p { margin: 0; }

      .pull-quote {
        border-left: 3px solid var(--accent-rust);
        padding: var(--sp-3) var(--sp-4);
        margin: var(--sp-5) 0;
        font-style: italic;
        color: var(--text-soft);
      }
      .pull-quote::before { content: '“'; color: var(--accent-rust); font-size: 2.5rem; font-family: var(--font-display); display: block; line-height: 0.6; margin-bottom: var(--sp-2); }
      .pull-quote p { margin: 0; font-size: 1.1rem; }

      .timeline { margin: var(--sp-5) 0; padding: 0; }
      .timeline .tl-item { display: flex; gap: var(--sp-4); padding: var(--sp-3) 0; border-bottom: 1px dashed var(--line); }
      .timeline .tl-item:last-child { border-bottom: none; }
      .timeline .tl-time { font-family: var(--font-mono); color: var(--accent-rust); font-size: 0.88rem; flex-shrink: 0; min-width: 110px; }
      .timeline .tl-text { color: var(--text-soft); font-size: 1rem; }
      .timeline .tl-text strong { color: var(--text); }

      .platform-list {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--sp-3); margin: var(--sp-6) 0;
      }
      .platform-list a {
        display: flex; flex-direction: column; gap: 4px;
        padding: var(--sp-3);
        border: 1px solid var(--line); border-radius: var(--r-md);
        color: var(--text-soft); text-decoration: none;
        font-family: var(--font-mono); font-size: 0.88rem;
        transition: all 0.2s;
      }
      .platform-list a:hover {
        border-color: var(--accent-rust); transform: translateY(-2px);
        background: rgba(200, 120, 80, 0.05);
      }
      .platform-list .pn { color: var(--text); font-weight: 500; }
      .platform-list .pd { color: var(--text-dim); font-size: 0.82rem; }

      .tags-row {
        display: flex; flex-wrap: wrap; gap: var(--sp-2);
        margin: var(--sp-8) 0 var(--sp-5);
        padding-top: var(--sp-5); border-top: 1px dashed var(--line);
      }
      .tags-row a {
        font-family: var(--font-mono); font-size: 0.82rem;
        padding: 4px 12px; border: 1px solid var(--line);
        border-radius: 20px; color: var(--text-soft); text-decoration: none;
        transition: all 0.2s;
      }
      .tags-row a:hover { border-color: var(--accent-rust); color: var(--accent-rust); }

      .cta-box {
        margin: var(--sp-8) 0;
        display: flex; flex-direction: column; align-items: flex-start;
        padding: var(--sp-4);
        border: 1px solid var(--line); border-radius: var(--r-lg);
        background: linear-gradient(135deg, rgba(200, 120, 80, 0.08), transparent);
      }
      .cta-box h3 {
        font-family: var(--font-display); font-weight: 500;
        font-size: 1.2rem; margin: 0 0 var(--sp-2);
      }
      .cta-box p { margin: 0 0 var(--sp-4); color: var(--text-soft); font-size: 0.95rem; }
      .cta-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 20px; background: var(--accent-rust);
        color: #fff; text-decoration: none; border-radius: 8px;
        font-family: var(--font-mono); font-size: 0.9rem;
        transition: transform 0.2s;
      }
      .cta-btn:hover { transform: translateY(-2px); }

      /* footer */
      footer.site-footer {
        border-top: 1px solid var(--line);
        padding: var(--sp-6);
        margin-top: var(--sp-8);
        color: var(--text-dim);
        font-size: 0.85rem;
        font-family: var(--font-mono);
      }
      footer.site-footer .footer-content {
        max-width: 960px; margin: 0 auto;
        display: flex; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap;
      }
      footer.site-footer .footer-brand { color: var(--text); font-weight: 500; font-family: var(--font-display); }

      .floating-top {
        position: fixed; bottom: 24px; right: 24px; z-index: 50;
        background: var(--bg-card, #1a1f2a); color: var(--text);
        border: 1px solid var(--line); border-radius: 50%;
        width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; opacity: 0; transition: opacity 0.3s;
      }
      .floating-top.visible { opacity: 1; }
      .floating-top:hover { border-color: var(--accent-rust); }

      /* 响应式 */
      @media (max-width: 768px) {
        nav.site-nav .nav-links { gap: var(--sp-3); font-size: 0.85rem; }
        article.article-body { padding: var(--sp-6) var(--sp-4); }
        article.article-body h2 { font-size: 1.35rem; }
      }

      /* 主题切换 - light */
      [data-theme="light"] nav.site-nav { background: rgba(248, 248, 245, 0.9); }
      [data-theme="light"] .cta-btn { color: #fff; }
      [data-theme="light"] .floating-top { background: #fff; }
    </style>
  </head>
  <body>
    <nav class="site-nav">
      <div class="nav-inner" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-5);">
        <a href="../../index.html" class="brand"><span class="logo">E</span><span>expectopatronus</span></a>
        <div class="nav-links">
          <a href="../../index.html">首页</a>
          <a href="../../home/home.html" class="is-active">文章</a>
          <a href="../../post/deepseek/deepseek.html">DeepSeek</a>
        </div>
        <button id="theme-toggle" class="theme-btn" aria-label="主题切换">
          <svg class="icon theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 13.5A9 9 0 0 1 10.5 3a7.5 7.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </nav>

    <section class="page-head">
      <div class="eyebrow">微信搬运 · ${escapeHtml(slug)}</div>
      <h1>${escapeHtml(opts.title)}</h1>
      <p>${escapeHtml(opts.summary)}</p>
      <div class="meta">
        <span><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 20c1.2-3.5 4-5 6.5-5s5.3 1.5 6.5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg> ${escapeHtml(opts.author || '佚名')}</span>
        <span><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> ${escapeHtml(opts.date)}</span>
      </div>

    <div class="hero-image"><img loading="lazy" src="${escapeHtml(opts.cover)}" alt="${escapeHtml(opts.title)}"/></div>
    </section>

    <article class="article-body">
${opts.content}
    </article>

    <footer class="site-footer">
      <div class="footer-content">
        <div>
          <div class="footer-brand">expectopatronus</div>
          <div class="footer-meta">© 2025 · 本站内容纯学习用途，非商用。原文版权归微信原作者所有。</div>
        </div>
      </div>
    </footer>

    <button class="floating-top" id="back-to-top" aria-label="返回顶部"><svg class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>

    <script>
      (function () {
        var MOON_SVG = '<path d="M21 13.5A9 9 0 0 1 10.5 3a7.5 7.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';
        var SUN_SVG = '<circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
        var saved = localStorage.getItem('theme') || 'dark';
        if (saved === 'light') document.documentElement.dataset.theme = 'light';
        var btnSvg = document.querySelector('#theme-toggle svg');
        if (btnSvg) btnSvg.innerHTML = saved === 'light' ? SUN_SVG : MOON_SVG;
        var btn = document.getElementById('theme-toggle');
        if (btn)
          btn.addEventListener('click', function () {
            var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
            document.documentElement.dataset.theme = next;
            localStorage.setItem('theme', next);
            var btnSvg2 = document.querySelector('#theme-toggle svg');
            if (btnSvg2) btnSvg2.innerHTML = next === 'light' ? SUN_SVG : MOON_SVG;
          });
        var back = document.getElementById('back-to-top');
        window.addEventListener('scroll', function () {
          if (back) back.classList.toggle('visible', window.scrollY > 300);
        });
        if (back)
          back.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
      })();
    </script>
  </body>
</html>`;
}

console.log('\n🎉 完成! slug=' + slug);
console.log('   文章路径: post/' + slug + '/' + slug + '.html');
