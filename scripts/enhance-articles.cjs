#!/usr/bin/env node
/**
 * scripts/enhance-articles.cjs
 * ─────────────────────────────────────────────────────────────
 * 一次性把 post/ 下的文章页对齐到新的信息架构。做四件事：
 *
 *   1. 把顶部导航换成全站统一的五项
 *      首页 / 文章 / 系列 / 关于 / 导航站
 *      （旧导航是 首页 / 文章 / DeepSeek / 导航站，
 *        读者在文章页里走不到「系列」和「关于」）
 *      所有页面都换，包括 post/deepseek/ 下那三个链接目录页。
 *
 *   2. 清掉残留的 home/script.js 引用（上一代列表页脚本）
 *
 *   3. 把 .tags-row 里的死链 <a href="#">#标签</a> 换成归档页的搜索深链
 *
 *   4. 在 </body> 前注入 post/article.js
 *      进度条 / 侧边目录 / 上下篇 / 相关阅读 / 来源声明 / 阅读时长
 *      全部由那个脚本运行时生成，文章 HTML 的正文结构一个字不动。
 *      只注入到真正的文章页（含 class="article-body" 的页面），
 *      链接目录页不注入。
 *
 * 所有操作都幂等：重复执行不会重复插入、不会重复替换。
 *
 * 用法：
 *   node scripts/enhance-articles.cjs            # 执行
 *   node scripts/enhance-articles.cjs --dry      # 只报告，不写文件
 *   node scripts/enhance-articles.cjs --revert   # 移除注入的脚本（导航不回滚）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POST_DIR = path.join(ROOT, 'post');

const DRY = process.argv.includes('--dry');
const REVERT = process.argv.includes('--revert');

/* 注入标记：用于识别「已注入」和「可精确移除」 */
const MARKER = 'data-article-enhance="1"';

/* ── 收集文章页 ───────────────────────────── */
function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (e.isFile() && e.name.endsWith('.html')) {
      out.push(p);
    }
  }
  return out;
}

/* ── 相对站点根的层级 ──────────────────────
   post/x/x.html              → 2  → ../../
   post/deepseek/doc/doc.html → 3  → ../../../ */
function depthOf(file) {
  return path.relative(ROOT, path.dirname(file)).split(path.sep).length;
}

function relScriptPath(file) {
  return '../'.repeat(depthOf(file)) + 'post/article.js';
}

/* ── 统一的五项导航 ───────────────────────── */
function navHtml(file) {
  const r = '../'.repeat(depthOf(file));
  return (
    `<a href="${r}index.html">首页</a>` +
    `<a href="${r}home/home.html" class="is-active">文章</a>` +
    `<a href="${r}home/series.html">系列</a>` +
    `<a href="${r}home/about.html">关于</a>` +
    `<a href="${r}nav/index.html" target="_blank" rel="noopener">导航站</a>`
  );
}

/* 把 nav-links 里的内容整体换掉。已经含 series.html 的视为已更新。 */
const NAV_RE = /(<div class="nav-links"[^>]*>)([\s\S]*?)(<\/div>)/;

function updateNav(html, file) {
  const m = html.match(NAV_RE);
  if (!m) return { html, changed: false, found: false };
  if (m[2].indexOf('home/series.html') !== -1) {
    return { html, changed: false, found: true };
  }
  const next = m[1] + navHtml(file) + m[3];
  return { html: html.replace(NAV_RE, next), changed: true, found: true };
}

/* ── 清理遗留的旧脚本引用 ─────────────────── */
/* home/script.js 是上一代列表页脚本，文章页引用它没有任何作用，
   而且它会在页面里查找 #grid / #popular / #tags 之类的旧容器。 */
function dropLegacyScripts(html) {
  const before = html;
  html = html.replace(/\s*<script src="[^"]*home\/script\.js"><\/script>/g, '');
  return { html, changed: html !== before };
}

/* ── 把标签行的死链换成搜索深链 ─────────────
   旧模板里标签有三种写法，全都点不动：
     <a href="#">#Vibe Coding</a>                  ← 纯死链
     <a href="../../home/home.html?tag=AI编程">…</a>  ← 指向已废弃的 ?tag= 参数
   新的归档页只认 ?cat= 与 ?q=，所以统一改写成 ?q= 深链，
   点进去就是归档页的搜索结果。 */
function linkTags(html, file) {
  const r = '../'.repeat(depthOf(file));
  const before = html;
  const tagsRe = /(<div class="tags-row[^"]*">)([\s\S]*?)(<\/div>)/g;

  html = html.replace(tagsRe, function (all, open, inner, close) {
    const next = inner.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, function (m, attrs, text) {
      const hrefM = attrs.match(/href="([^"]*)"/);
      if (!hrefM) return m;
      const href = hrefM[1];
      /* 只处理两种坏链接，正常的站内/站外链接不动 */
      if (href !== '#' && href.indexOf('?tag=') === -1) return m;

      const label = text.replace(/<[^>]+>/g, '').trim();
      const q = label.replace(/^#/, '').trim();
      if (!q) return m;

      const newAttrs = attrs.replace(
        /href="[^"]*"/,
        'href="' + r + 'home/home.html?q=' + encodeURIComponent(q) + '"'
      );
      return '<a' + newAttrs + '>' + text + '</a>';
    });
    return open + next + close;
  });

  return { html, changed: html !== before };
}

/* ── 判断是否已经是文章页 ─────────────────── */
function isArticlePage(html) {
  return /class="article-body"/.test(html);
}

/* ── 主流程 ───────────────────────────────── */
function main() {
  if (!fs.existsSync(POST_DIR)) {
    console.error('找不到 post/ 目录：' + POST_DIR);
    process.exit(1);
  }

  const files = walk(POST_DIR, []);
  let navFixed = 0;
  let navAlready = 0;
  let navMissing = 0;
  let injected = 0;
  let already = 0;
  let legacyCleaned = 0;
  let tagsLinked = 0;
  let reverted = 0;
  let skipped = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    let html = fs.readFileSync(file, 'utf8');

    /* ── 回滚模式：只移除注入的脚本 ── */
    if (REVERT) {
      const re = new RegExp(
        '\\s*<script src="[^"]*post/article\\.js"[^>]*' + MARKER + '></script>',
        'g'
      );
      if (!re.test(html)) {
        skipped++;
        continue;
      }
      const next = html.replace(re, '');
      if (!DRY) fs.writeFileSync(file, next, 'utf8');
      reverted++;
      console.log('  - ' + rel);
      continue;
    }

    const article = isArticlePage(html);

    /* 1. 导航：所有页面都统一，包括 post/deepseek/ 下的链接目录页 */
    const nav = updateNav(html, file);
    if (!nav.found) navMissing++;
    else if (nav.changed) {
      html = nav.html;
      navFixed++;
    } else navAlready++;

    if (!article) {
      /* 非文章页只统一导航，不做标签改写和脚本注入 */
      if (nav.changed && !DRY) fs.writeFileSync(file, html, 'utf8');
      skipped++;
      continue;
    }

    /* 2. 遗留脚本 */
    const legacy = dropLegacyScripts(html);
    if (legacy.changed) {
      html = legacy.html;
      legacyCleaned++;
    }

    /* 3. 标签死链 */
    const tags = linkTags(html, file);
    if (tags.changed) {
      html = tags.html;
      tagsLinked++;
    }

    /* 4. 增强脚本注入 */
    let didInject = false;
    if (html.indexOf(MARKER) !== -1) {
      already++;
    } else if (html.indexOf('</body>') === -1) {
      console.warn('  ! 没有 </body>，跳过注入：' + rel);
    } else {
      const tag = `<script src="${relScriptPath(file)}" defer ${MARKER}></script>`;
      html = html.replace(/<\/body>/, '  ' + tag + '\n  </body>');
      injected++;
      didInject = true;
    }

    if ((nav.changed || legacy.changed || tags.changed || didInject) && !DRY) {
      fs.writeFileSync(file, html, 'utf8');
    }
  }

  console.log('');
  console.log('文章页总数          ' + files.length);
  if (REVERT) {
    console.log('已移除注入          ' + reverted);
  } else {
    console.log('导航已更新          ' + navFixed);
    console.log('导航本来就是新的    ' + navAlready);
    if (navMissing) console.log('未找到 nav-links    ' + navMissing);
    console.log('清理遗留脚本        ' + legacyCleaned);
    console.log('标签死链已修        ' + tagsLinked);
    console.log('本次注入增强脚本    ' + injected);
    console.log('此前已注入          ' + already);
  }
  console.log('非文章页（只换导航） ' + skipped);
  if (DRY) console.log('\n（--dry 模式，未写入任何文件）');
}

main();
