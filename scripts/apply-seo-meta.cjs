#!/usr/bin/env node
/**
 * scripts/apply-seo-meta.cjs
 * ─────────────────────────────────────────────────────────────────────────
 * 给 post/ 下所有文章页幂等注入 canonical / og:* / twitter:card / JSON-LD。
 * 与 apply-read-css.cjs 同一套路：只动 <head>，正文一个字不改。
 *
 * 元数据来源（不依赖任何 npm 包）：
 *   · pageUrl   文件相对仓库根的路径 + SITE_URL，和 sitemap.xml 的 <loc> 完全对齐
 *   · date      home/articles.js 的 date → sitemap.xml 的 lastmod → HTML 里的日期
 *   · title     og:title → <title>（去掉站点后缀）→ <h1>
 *   · desc      meta description → og:description
 *   · image     同目录有 cover.jpg 就用它，否则用全站兜底图 home/og-default.jpg
 *
 * 用法：
 *   node scripts/apply-seo-meta.cjs           # 执行注入（幂等，可重复跑）
 *   node scripts/apply-seo-meta.cjs --dry     # 只报告，不写文件
 *   node scripts/apply-seo-meta.cjs --check  # 有缺口时退出码 1（给 CI / 自检用）
 *   node scripts/apply-seo-meta.cjs --show   # 打印一个样例文件的注入结果
 *   node scripts/apply-seo-meta.cjs --revert # 移除本脚本注入的内容
 *
 * 注意：新文章由 build-article.cjs 在渲染时直接带上，不需要再跑本脚本。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { siteUrl, stripSeo, injectSeo, readMeta, BEGIN } = require('./seo-meta.cjs');

const ROOT = path.resolve(__dirname, '..');
const POST_DIR = path.join(ROOT, 'post');
const ARTICLES = path.join(ROOT, 'home', 'articles.js');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

const DRY = process.argv.includes('--dry');
const CHECK = process.argv.includes('--check');
const SHOW = process.argv.includes('--show');
const REVERT = process.argv.includes('--revert');

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/* articles.js: '../post/x/x.html' → 2026-11-11 */
function articleDates() {
  const src = fs.readFileSync(ARTICLES, 'utf8');
  const m = src.match(/window\.articles\s*=\s*\[([\s\S]*?)\n\s*\](?=\s*[;,])/);
  const map = Object.create(null);
  if (!m) return map;
  let depth = 0, cur = '', inStr = false, strCh = '';
  const objs = [];
  for (let i = 0; i < m[1].length; i++) {
    const c = m[1][i];
    if (inStr) {
      cur += c;
      if (c === strCh && m[1][i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; cur += c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) { objs.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) objs.push(cur);
  for (const o of objs) {
    const url = (o.match(/url\s*:\s*["']([^"']+)["']/) || [])[1];
    const date = (o.match(/date\s*:\s*["']([^"']+)["']/) || [])[1];
    /* 老条目里 date 可能带时间（'2026-06-17 20:40'），JSON-LD 只要日期段 */
    if (url && date && /^\d{4}-\d{2}-\d{2}/.test(date)) map[url] = date.slice(0, 10);
  }
  return map;
}

/* sitemap.xml: <loc>…</loc><lastmod>…</lastmod> */
function sitemapDates() {
  const map = Object.create(null);
  if (!fs.existsSync(SITEMAP)) return map;
  const src = fs.readFileSync(SITEMAP, 'utf8');
  const re = /<loc>\s*([^<]+?)\s*<\/loc>\s*<lastmod>\s*(\d{4}-\d{2}-\d{2})\s*<\/lastmod>/g;
  let m;
  while ((m = re.exec(src))) map[m[1]] = m[2];
  return map;
}

const site = siteUrl();
const byArticle = articleDates();
const bySitemap = sitemapDates();
const files = walk(POST_DIR, []);
const changed = [];
const skipped = [];
let sample = '';

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  if (html.search(/<\/head>/i) < 0) { skipped.push(rel(file)); continue; }

  if (REVERT) {
    const out = stripSeo(html);
    if (out !== html) {
      if (!DRY) fs.writeFileSync(file, out, 'utf8');
      changed.push(rel(file));
    }
    continue;
  }

  const relPath = rel(file);
  const pageUrl = site + '/' + relPath;
  const articleKey = '../' + relPath;
  const imageUrl = fs.existsSync(path.join(path.dirname(file), 'cover.jpg'))
    ? site + '/' + path.posix.dirname(relPath) + '/cover.jpg'
    : site + '/home/og-default.jpg';

  const parsed = readMeta(html, {
    date: byArticle[articleKey] || bySitemap[pageUrl] || null,
  });
  const out = injectSeo(html, {
    pageUrl,
    title: parsed.title,
    description: parsed.description,
    date: parsed.date,
    imageUrl,
  });

  if (out !== html) {
    if (!DRY && !CHECK) fs.writeFileSync(file, out, 'utf8');
    changed.push(relPath);
    if (!sample) {
      const end = out.indexOf('<!-- seo:end -->');
      sample = out.slice(Math.max(0, out.indexOf(BEGIN) - 120), end + 20);
    }
  }
}

if (REVERT) {
  console.log((DRY ? '[dry] ' : '') + '已移除 SEO 块 ' + changed.length + ' 处 / 共 ' + files.length + ' 个文章页');
} else if (CHECK || DRY) {
  console.log('共 ' + files.length + ' 个文章页，需更新 ' + changed.length + ' 个，无 </head> 跳过 ' + skipped.length + ' 个');
  for (const f of changed.slice(0, 20)) console.log('  - ' + f);
  if (changed.length > 20) console.log('  … 还有 ' + (changed.length - 20) + ' 个');
  for (const f of skipped) console.log('  ! 无 </head>：' + f);
  if (SHOW && sample) console.log('\n───── 注入样例 ─────\n' + sample);
  if (CHECK && (changed.length || skipped.length)) process.exit(1);
} else {
  console.log('共 ' + files.length + ' 个文章页：新注入/更新 ' + changed.length + ' 个，已是最新 ' + (files.length - changed.length - skipped.length) + ' 个，跳过 ' + skipped.length + ' 个');
  for (const f of changed.slice(0, 8)) console.log('  + ' + f);
  if (changed.length > 8) console.log('  … 另有 ' + (changed.length - 8) + ' 个');
  for (const f of skipped) console.log('  ! 无 </head>：' + f);
  if (SHOW && sample) console.log('\n───── 注入样例 ─────\n' + sample);
}
