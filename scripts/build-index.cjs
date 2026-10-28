#!/usr/bin/env node
/**
 * 从 home/articles.js 里的 window.articles 生成两份订阅产物：
 *
 *   feed.xml      全站 RSS 2.0（最近 30 篇）
 *   sitemap.xml   给搜索引擎的站点地图
 *
 * 用法：
 *   node scripts/build-index.cjs
 *
 * 设计约束：
 *   1. 不依赖任何 npm 包，只用 node 内置模块 —— 这个仓库没有构建步骤，
 *      这个脚本也不应该成为第一个。
 *   2. 解析 articles.js 用的是和 scripts/repo-lint.cjs 同一套思路：
 *      先定位 window.articles = [ ... ]，再按花括号配对拆对象。
 *      不 eval 那个文件，避免执行到派生层里依赖浏览器的代码。
 *   3. 站内搜索不需要这个脚本 —— 首页直接读 articles.js 在内存里过滤，
 *      121 篇的量级没必要再多传一份索引。
 *
 * 站点根地址取环境变量 SITE_URL，没有就用 GitHub Pages 的默认地址。
 * 绑了自定义域名的话：SITE_URL=https://your.domain node scripts/build-index.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTICLES = path.join(ROOT, 'home', 'articles.js');

const DEFAULT_SITE = 'https://expectopatronus00.github.io';

/* 被合并掉的重复文章，不进 feed / sitemap */
const MERGED_IDS = ['dy-7652001000000000001', 'dy-7650776381453765903'];

const ORIGINAL_IDS = ['deepseek-doc', 'deepseek-api', 'deepseek-main', 'post1'];

function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  return DEFAULT_SITE;
}

function sourceOf(id) {
  if (id.indexOf('dy-') === 0) return '抖音';
  if (id.indexOf('xhs-') === 0) return '小红书';
  if (ORIGINAL_IDS.indexOf(id) !== -1) return '原创';
  return '微信';
}

/* ── 旧分类 → 新主题桶 ──────────────────────────
   feed 的 <category> 必须写读者看到的桶名，不能写 articles.js 里的旧值
   （那里还留着「抖音搬运」这类来源维度分类）。

   这三张表不在这里抄一份 —— 直接从 home/articles.js 的派生层里解析出来。
   抄一份的话，以后往 CATEGORY_BY_ID 里补新文章，feed 就会悄悄和站内不一致。 */

/** 抓出 `var NAME = { ... };` 或 `var NAME = [ ... ];` 的块文本 */
function grabBlock(src, name) {
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*([\\[{])');
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf(m[1], m.index);
  const end = matchBracket(src, open, m[1], m[1] === '{' ? '}' : ']');
  return end === -1 ? null : src.slice(open, end + 1);
}

/** 桶 id → 中文名，从 CATEGORIES 数组里取 */
function parseBucketNames(src) {
  const block = grabBlock(src, 'CATEGORIES');
  const map = {};
  if (!block) return map;
  const re = /\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) map[m[1]] = m[2];
  return map;
}

/** 旧分类名 → 桶 id */
function parseDefaultCategory(src) {
  const block = grabBlock(src, 'DEFAULT_CATEGORY');
  const map = {};
  if (!block) return map;
  const re = /'([^']+)'\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) map[m[1]] = m[2];
  return map;
}

/** 文章 id → 桶 id（逐条覆盖） */
function parseCategoryById(src) {
  const block = grabBlock(src, 'CATEGORY_BY_ID');
  const map = {};
  if (!block) return map;
  const re = /'([^']+)'\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) map[m[1]] = m[2];
  return map;
}

/* ── 解析 articles.js ────────────────────────── */

/** 从 src[open] 处的开括号开始，找到配对的闭括号位置，跳过字符串里的括号 */
function matchBracket(src, open, opener, closer) {
  let depth = 0;
  let inStr = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 把数组体拆成一个个 {...} 字符串 */
function splitObjects(body) {
  const out = [];
  let level = 0;
  let start = -1;
  let inStr = null;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const prev = body[i - 1];
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '{') {
      if (level === 0) start = i;
      level++;
    } else if (ch === '}') {
      level--;
      if (level === 0 && start !== -1) {
        out.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function strField(obj, name) {
  const m = obj.match(new RegExp('\\b' + name + "\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'"));
  return m ? m[1].replace(/\\'/g, "'") : '';
}

function parseArticles(src) {
  const at = src.indexOf('window.articles');
  if (at === -1) throw new Error('在 home/articles.js 里找不到 window.articles');

  const open = src.indexOf('[', at);
  if (open === -1) throw new Error('window.articles 后面没有数组');

  const end = matchBracket(src, open, '[', ']');
  if (end === -1) throw new Error('window.articles 数组没有闭合');

  return splitObjects(src.slice(open + 1, end))
    .map((obj) => {
      const id = strField(obj, 'id');
      if (!id) return null;
      return {
        id,
        title: strField(obj, 'title') || id,
        url: strField(obj, 'url'),
        summary: strField(obj, 'summary'),
        category: strField(obj, 'category'),
        date: strField(obj, 'date'),
      };
    })
    .filter(Boolean);
}

/* ── 输出 ────────────────────────────────────── */

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc822(dateStr) {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00+08:00');
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

function absUrl(site, rel) {
  return site + '/' + rel.replace(/^\.\.\//, '');
}

function byDateDesc(x, y) {
  return x.date < y.date ? 1 : x.date > y.date ? -1 : 0;
}

function buildFeed(articles, site, categoryOf) {
  const items = articles
    .filter((a) => MERGED_IDS.indexOf(a.id) === -1)
    .sort(byDateDesc)
    .slice(0, 30);

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>expectopatronus</title>',
    '    <link>' + site + '/</link>',
    '    <description>一个 AI 工具与实战的中文学习归档：原创踩坑记录 + 精选转载，每篇都标注来源。</description>',
    '    <language>zh-CN</language>',
    '    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>',
    '    <atom:link href="' + site + '/feed.xml" rel="self" type="application/rss+xml" />',
  ];

  for (const a of items) {
    const src = sourceOf(a.id);
    const link = absUrl(site, a.url);
    const note = src === '原创' ? '（原创）' : '（转载 · 来源：' + src + '）';
    out.push(
      '    <item>',
      '      <title>' + esc(a.title) + '</title>',
      '      <link>' + esc(link) + '</link>',
      '      <guid isPermaLink="true">' + esc(link) + '</guid>',
      '      <pubDate>' + rfc822(a.date) + '</pubDate>',
      '      <category>' + esc(categoryOf(a)) + '</category>',
      '      <description>' + esc(a.summary + note) + '</description>',
      '    </item>'
    );
  }

  out.push('  </channel>', '</rss>');
  return out.join('\n') + '\n';
}

function buildSitemap(articles, site) {
  const statics = [
    ['/', '1.0', 'weekly'],
    ['/home/home.html', '0.9', 'weekly'],
    ['/home/series.html', '0.7', 'monthly'],
    ['/home/about.html', '0.6', 'monthly'],
    ['/nav/index.html', '0.5', 'weekly'],
  ];

  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];

  for (const [loc, pri, freq] of statics) {
    out.push(
      '  <url>',
      '    <loc>' + esc(site + loc) + '</loc>',
      '    <changefreq>' + freq + '</changefreq>',
      '    <priority>' + pri + '</priority>',
      '  </url>'
    );
  }

  for (const a of articles) {
    if (MERGED_IDS.indexOf(a.id) !== -1) continue;
    out.push(
      '  <url>',
      '    <loc>' + esc(absUrl(site, a.url)) + '</loc>',
      '    <lastmod>' + a.date.slice(0, 10) + '</lastmod>',
      '    <changefreq>yearly</changefreq>',
      '    <priority>0.6</priority>',
      '  </url>'
    );
  }

  out.push('</urlset>');
  return out.join('\n') + '\n';
}

/* ── 主流程 ──────────────────────────────────── */

function main() {
  if (!fs.existsSync(ARTICLES)) {
    console.error('找不到 ' + ARTICLES);
    process.exit(1);
  }

  const articles = parseArticles(fs.readFileSync(ARTICLES, 'utf8'));
  if (!articles.length) {
    console.error('解析出的文章数是 0，检查 window.articles 的格式');
    process.exit(1);
  }

  /* 从派生层解析桶名映射，给 feed 的 <category> 用 */
  const src = fs.readFileSync(ARTICLES, 'utf8');
  const bucketNames = parseBucketNames(src);
  const defaultCat = parseDefaultCategory(src);
  const byId = parseCategoryById(src);
  if (!Object.keys(bucketNames).length) {
    console.error('没能从 articles.js 解析出 CATEGORIES，检查格式是否变了');
    process.exit(1);
  }
  const categoryOf = (a) => {
    const bucket = byId[a.id] || defaultCat[a.category] || 'misc';
    return bucketNames[bucket] || '杂项';
  };

  const missing = articles.filter((a) => !a.url || !a.date);
  if (missing.length) {
    console.error('以下条目缺 url 或 date：' + missing.map((a) => a.id).join(', '));
    process.exit(1);
  }

  const site = siteUrl();

  const feedPath = path.join(ROOT, 'feed.xml');
  const sitemapPath = path.join(ROOT, 'sitemap.xml');

  /* 内容没变就不落盘：lastBuildDate 每次都取当前时间，无条件写会让「没有新文章
     的日子」也产生一次只有时间戳变化的提交，把 git 历史搅浑。 */
  const feedState = writeIfChanged(feedPath, buildFeed(articles, site, categoryOf), true);
  const sitemapState = writeIfChanged(sitemapPath, buildSitemap(articles, site), false);

  console.log('站点地址  ' + site);
  console.log('文章总数  ' + articles.length);
  console.log('主题桶    ' + Object.keys(bucketNames).length + ' 个');
  console.log(
    (feedState === 'written' ? '已写入    ' : '未变化    ') + 'feed.xml（最近 30 篇）'
  );
  console.log(
    (sitemapState === 'written' ? '已写入    ' : '未变化    ') +
      'sitemap.xml（' + (articles.length - MERGED_IDS.length + 5) + ' 条 URL）'
  );
}

/** 只在内容真的变了才写盘。keepBuildDate 为真时，只有时间戳不同视为「没变」。 */
function writeIfChanged(file, next, keepBuildDate) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (prev === next) return 'unchanged';

  if (keepBuildDate && prev) {
    const prevDate = (prev.match(/<lastBuildDate>([^<]*)<\/lastBuildDate>/) || [])[1];
    const nextDate = (next.match(/<lastBuildDate>([^<]*)<\/lastBuildDate>/) || [])[1];
    if (prevDate && nextDate && next.replace(nextDate, prevDate) === prev) {
      return 'unchanged';
    }
  }

  fs.writeFileSync(file, next, 'utf8');
  return 'written';
}

main();
