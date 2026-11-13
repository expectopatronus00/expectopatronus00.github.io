#!/usr/bin/env node
/**
 * 首页静态兜底 —— 把 index.html 里四个纯 JS 渲染的容器预先填好内容。
 *
 * 为什么：原来首页的「最新条目 / 系列 / 主题 / 最近更新」四块完全靠
 * home/articles.js + innerHTML 生成，静态 HTML 里一个文章标题都没有。
 * 禁用 JS 的浏览器、部分爬虫和 RSS 阅读器看到的是空壳。
 *
 * 做法：用 Node 的 vm 直接执行 home/articles.js 拿到同一个 window.BLOG，
 * 复用 index.html 内联脚本的渲染逻辑逐字生成四个片段，幂等注入到容器里。
 * JS 加载后会用 innerHTML 覆盖成同样的内容，因此有 JS 时零视觉跳变。
 *
 *   node scripts/home-static.cjs              生成/更新静态兜底
 *   node scripts/home-static.cjs --check     只检查是否已最新（CI 用）
 *   node scripts/home-static.cjs --show      预览四个片段的长度与开头
 *
 * 调用方：build-index.cjs（daily-run 自动）、build-article.cjs --index（当天新稿立即生效）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ARTICLES = path.join(ROOT, 'home', 'articles.js');
const INDEX_HTML = path.join(ROOT, 'index.html');

const CONTAINERS = ['panel-list', 'series-grid', 'cat-grid', 'latest-grid'];

function loadBlog() {
  const src = fs.readFileSync(ARTICLES, 'utf8');
  const sandbox = {
    document: {},
    localStorage: { getItem: () => null },
  };
  sandbox.window = sandbox; // articles.js 里写的是 window.BLOG / window.articles
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 5000 });
  if (!sandbox.BLOG) throw new Error('articles.js 没暴露 window.BLOG');
  return sandbox.BLOG;
}

/** 与 index.html 内联渲染脚本一一对应，输出格式也保持一致（单行拼接）。 */
function renderBlocks(BLOG) {
  const fixUrl = (u) => String(u).replace(/^\.\.\//, '');

  const panel = BLOG.latest(4)
    .map(function (a, i) {
      return (
        '<a class="p-item" href="' + fixUrl(a.url) + '">' +
        '<div class="num">' + ('0' + (i + 1)).slice(-2) + '</div>' +
        '<div><h4>' + a.title + '</h4><p>' + a.summary + '</p></div>' +
        '<div class="mini-tag">' + (a.original ? '原创' : a.source) + '</div>' +
        '</a>'
      );
    })
    .join('');

  const series = BLOG.series
    .map(function (s, i) {
      var eps = BLOG.inSeries(s.id);
      var no = ('0' + (i + 1)).slice(-2);
      return (
        '<a class="series-card" href="home/series.html#' + s.id + '">' +
        '<div class="sc-top"><span class="sc-no">' + no + '</span>' +
        '<span class="sc-count">' + eps.length + ' 篇</span></div>' +
        '<h3>' + s.name + '</h3><p>' + s.desc + '</p>' +
        '<div class="sc-foot">按顺序阅读 →</div></a>'
      );
    })
    .join('');

  const cards = [];
  BLOG.categories.forEach(function (c) {
    var n = BLOG.inCategory(c.name).length;
    if (n === 0) return;
    cards.push(
      '<a class="cat-card" href="home/home.html?cat=' + encodeURIComponent(c.name) + '">' +
      '<div class="num">' + ('0' + (cards.length + 1)).slice(-2) + '</div>' +
      '<h3>' + c.name + '<span class="cat-n">' + n + '</span></h3>' +
      '<p>' + c.desc + '</p><div class="arrow">进入 →</div></a>'
    );
  });

  const latest = BLOG.latest(12)
    .map(function (a) {
      var url = fixUrl(a.url);
      var date = String(a.date).slice(0, 10).replace(/-/g, ' · ');
      return (
        '<a class="article-card" href="' + url + '">' +
        '<div class="art-body"><div class="date">' + date +
        '<span class="card-src">' + (a.original ? '原创' : a.source) + '</span></div>' +
        '<h3>' + a.title + '</h3><p>' + a.summary + '</p></div></a>'
      );
    })
    .join('');

  return {
    'panel-list': panel,
    'series-grid': series,
    'cat-grid': cards.join(''),
    'latest-grid': latest,
  };
}

function beginTag(id) { return '<!-- static:' + id + ':begin -->'; }
function endTag(id) { return '<!-- static:' + id + ':end -->'; }

/** 提取 index.html 里当前四个静态块的原文；缺标记返回 null。 */
function extractBlocks(html) {
  const out = {};
  for (const id of CONTAINERS) {
    const b = beginTag(id), e = endTag(id);
    const i = html.indexOf(b), j = html.indexOf(e);
    out[id] = i >= 0 && j > i ? html.slice(i + b.length, j).trim() : null;
  }
  return out;
}

function injectInto(html, id, content) {
  const b = beginTag(id), e = endTag(id);
  const existing = new RegExp('(' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')([\\s\\S]*?)(' + e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')');
  if (existing.test(html)) {
    return html.replace(existing, function (_m, a, _old, c) {
      return a + '\n        ' + content + '\n        ' + c;
    });
  }
  /* 首次注入：原始容器里只有一行注释、没有嵌套 div，所以非贪婪到第一个 </div> 是安全的 */
  const open = new RegExp('(<div[^>]*id="' + id + '"[^>]*>)([\\s\\S]*?)(\\s*</div>)');
  if (!open.test(html)) throw new Error('index.html 里找不到容器 #' + id);
  return html.replace(open, function (_m, a, _old, c) {
    return a + '\n        ' + b + '\n        ' + content + '\n        ' + e + c;
  });
}

/** 生成 / 更新静态兜底。check=true 时不写盘，只报告是否需要更新。 */
function syncIndexStatic(opts = {}) {
  const check = !!opts.check;
  const blog = loadBlog();
  const blocks = renderBlocks(blog);
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  let next = html;
  for (const id of CONTAINERS) next = injectInto(next, id, blocks[id]);
  const changed = next !== html;
  if (changed && !check) fs.writeFileSync(INDEX_HTML, next, 'utf8');
  return { changed, blocks, latestTitle: blog.latest(1)[0].title };
}

/* ─────────── CLI ─────────── */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--show')) {
    const blocks = renderBlocks(loadBlog());
    for (const id of CONTAINERS) {
      console.log(id + ' · ' + Buffer.byteLength(blocks[id]) + ' B · ' + blocks[id].slice(0, 110) + '…');
    }
  } else {
    const r = syncIndexStatic({ check: args.includes('--check') });
    console.log(
      (args.includes('--check') ? (r.changed ? '✗ 首页静态兜底已过期' : '✓ 首页静态兜底已是最新') : (r.changed ? '✅ 已更新首页静态兜底' : '✓ 首页静态兜底无变化')) +
      ' · 最新文章：' + r.latestTitle
    );
    if (args.includes('--check') && r.changed) process.exit(1);
  }
}

module.exports = { CONTAINERS, loadBlog, renderBlocks, extractBlocks, syncIndexStatic };
