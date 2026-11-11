#!/usr/bin/env node
/**
 * scripts/apply-read-css.cjs
 * ─────────────────────────────────────────────────────────────────────────
 * 给 post 目录下所有 .html 文章页注入共享易读性样式 post/article-read.css。
 *
 * 为什么必须放在 </head> 前：每篇文章都内嵌了一份 <style>，只有把 <link>
 * 排在内嵌样式之后，article-read.css 才能在同特异性下生效，不必用 !important。
 * 正文一个字都不改，只加一行 <link>。
 *
 * 幂等：已含 article-read.css 的文件直接跳过；重复执行不产生第二行。
 * 相对路径按目录深度算，post/x/x.html 与 post/deepseek/doc/doc.html 都能对。
 *
 * 用法：
 *   node scripts/apply-read-css.cjs           # 执行注入
 *   node scripts/apply-read-css.cjs --dry     # 只报告，不写文件
 *   node scripts/apply-read-css.cjs --check  # 有缺失时退出码 1（给 CI / 自检用）
 *   node scripts/apply-read-css.cjs --revert # 移除本脚本注入的 <link>
 *
 * 注意：新文章由 build-article.cjs 在渲染时自动带上这一行，不需要再跑本脚本。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POST_DIR = path.join(ROOT, 'post');
const CSS_FILE = path.join(POST_DIR, 'article-read.css');
const MARKER = 'data-read-css="1"';

const DRY = process.argv.includes('--dry');
const CHECK = process.argv.includes('--check');
const REVERT = process.argv.includes('--revert');

if (!fs.existsSync(CSS_FILE)) {
  console.error('✖ 找不到 post/article-read.css，先创建样式文件');
  process.exit(1);
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/* post/x/x.html → 2 → ../../post/article-read.css
   post/deepseek/doc/doc.html → 3 → ../../../post/article-read.css */
function hrefOf(file) {
  const depth = path.relative(ROOT, path.dirname(file)).split(path.sep).length;
  return '../'.repeat(depth) + 'post/article-read.css';
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

const files = walk(POST_DIR, []);
const missing = [];
const injected = [];
const reverted = [];
const skipped = [];

for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');

  if (REVERT) {
    const re = new RegExp('\\n?[ \\t]*<link rel="stylesheet" href="[^"]*article-read\\.css"[^>]*' + MARKER + '[^>]*/?>[ \\t]*\\r?\\n?', 'i');
    if (!re.test(html)) continue;
    if (!DRY) fs.writeFileSync(file, html.replace(re, '\n'), 'utf8');
    reverted.push(rel(file));
    continue;
  }

  if (html.includes('article-read.css')) continue;

  const at = html.search(/<\/head>/i);
  if (at < 0) {
    skipped.push(rel(file));
    continue;
  }

  if (CHECK || DRY) {
    missing.push(rel(file));
    continue;
  }

  const line = '    <link rel="stylesheet" href="' + hrefOf(file) + '" ' + MARKER + ' />\n';
  html = html.slice(0, at) + line + html.slice(at);
  fs.writeFileSync(file, html, 'utf8');
  injected.push(rel(file));
}

if (REVERT) {
  console.log((DRY ? '[dry] ' : '') + '已移除 ' + reverted.length + ' 处注入');
} else if (CHECK || DRY) {
  console.log('共 ' + files.length + ' 个文章页，缺 ' + missing.length + ' 个，无 </head> 跳过 ' + skipped.length + ' 个');
  for (const f of missing.slice(0, 20)) console.log('  - ' + f);
  if (missing.length > 20) console.log('  … 还有 ' + (missing.length - 20) + ' 个');
  for (const f of skipped) console.log('  ! 无 </head>：' + f);
  if (CHECK && (missing.length || skipped.length)) process.exit(1);
} else {
  console.log('共 ' + files.length + ' 个文章页：新注入 ' + injected.length + ' 个，已有 ' + (files.length - injected.length - skipped.length) + ' 个，跳过 ' + skipped.length + ' 个');
  for (const f of injected.slice(0, 8)) console.log('  + ' + f);
  if (injected.length > 8) console.log('  … 另有 ' + (injected.length - 8) + ' 个');
  for (const f of skipped) console.log('  ! 无 </head>：' + f);
}
