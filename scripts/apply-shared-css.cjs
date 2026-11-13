#!/usr/bin/env node
/**
 * 幂等抽取文章页里重复的内联 CSS。
 *
 *   node scripts/apply-shared-css.cjs --dry       预览会改哪些文件
 *   node scripts/apply-shared-css.cjs             执行（生成共享 CSS + 原位替换）
 *   node scripts/apply-shared-css.cjs --check     只检查是否还需要更新（CI 用）
 *   node scripts/apply-shared-css.cjs --show post/<id>/<id>.html
 *   node scripts/apply-shared-css.cjs --revert    把共享 link 还原成内联 <style>
 *
 * 共享 CSS 的内容 == 原 <style> 内部文本，不做 trim，保证 --revert 字节级还原。
 * HTML 只做字符串 replace，不重新格式化，避免 Windows 下 LF 变 CRLF。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT, SHARED, COMMON, STYLE_RE,
  hashOf, walkPosts, stylesOf, linksOf, cssFileFor, linkTag, survey,
} = require('./shared-css.cjs');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const doDry = has('--dry');
const doCheck = has('--check');
const doRevert = has('--revert');
const showFile = opt('--show');

function rel(f) {
  return path.relative(ROOT, f).replace(/\\/g, '/');
}

/* ─────────── revert ─────────── */
if (doRevert) {
  let changed = 0, missing = 0;
  for (const f of walkPosts()) {
    const html = fs.readFileSync(f, 'utf8');
    const links = linksOf(html);
    if (!links.length) continue;
    let next = html;
    for (const l of links) {
      const target = path.resolve(path.dirname(f), l.href);
      if (!fs.existsSync(target)) {
        console.error('  ✗ 找不到共享 CSS，无法还原：' + rel(target));
        missing++;
        continue;
      }
      const css = fs.readFileSync(target, 'utf8');
      next = next.replace(l.full, '<style>' + css + '</style>');
    }
    if (next !== html) {
      if (!doDry) fs.writeFileSync(f, next, 'utf8');
      changed++;
    }
  }
  console.log('已还原 ' + changed + ' 篇文章页' + (missing ? '，' + missing + ' 处缺文件' : ''));
  console.log('共享 CSS 文件保留未删（post/article-common.css 与 post/_shared/），确认无用后可手动移除。');
  process.exit(missing ? 1 : 0);
}

/* ─────────── show ─────────── */
const s = survey();
if (showFile) {
  const f = path.resolve(ROOT, showFile);
  if (!fs.existsSync(f)) {
    console.error('文件不存在：' + showFile);
    process.exit(1);
  }
  const html = fs.readFileSync(f, 'utf8');
  console.log('文件 ' + rel(f));
  for (const st of stylesOf(html)) {
    const g = s.groups.get(st.hash);
    const repeated = s.repeatHashes.has(st.hash);
    console.log('  内联 CSS ' + st.hash + ' · ' + Buffer.byteLength(st.css) + ' B · 全站出现 ' + (g ? g.count : 0) + ' 次 · ' + (repeated ? '可抽' : '独有，保留'));
    if (repeated) console.log('    → ' + linkTag(f, st.hash, s.commonHash));
  }
  for (const l of linksOf(html)) console.log('  已引用共享 CSS ' + l.hash + ' → ' + l.href);
  process.exit(0);
}

/* ─────────── 计算需要生成的共享文件 ─────────── */
const targets = new Map(); // 绝对路径 -> CSS 文本
for (const [h, g] of s.ranked) {
  if (g.count < 2) continue;
  targets.set(cssFileFor(h, s.commonHash), g.css);
}

/* ─────────── 逐篇计算替换 ─────────── */
const changes = [];   // { file, next, n }
const skipped = [];   // 带属性的 <style>，保守跳过
const styleRe = new RegExp(STYLE_RE.source, 'gi');
for (const page of s.pages) {
  const { file, html } = page;
  let n = 0;
  const next = html.replace(styleRe, (full, css) => {
    const h = hashOf(css);
    if (!s.repeatHashes.has(h)) return full;
    if (!full.startsWith('<style>')) {
      skipped.push(rel(file) + ' (' + h + ')');
      return full;
    }
    n++;
    return linkTag(file, h, s.commonHash);
  });
  if (n > 0 && next !== html) changes.push({ file, next, n });
}

/* ─────────── 共享文件差异 ─────────── */
const cssWrites = [];
for (const [file, css] of targets) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev !== css) cssWrites.push({ file, bytes: Buffer.byteLength(css) });
}

/* ─────────── 现有共享 link 完整性 ─────────── */
/* 重复内联 CSS 抽完后 survey() 看不到任何重复组，--check 会误判「一切正常」。
   因此必须单独校验每处 link：文件还在、内容 hash 对得上。文件名里的 hash 就是校验和。 */
const brokenLinks = [];
let liveLinks = 0;
for (const f of walkPosts()) {
  const html = fs.readFileSync(f, 'utf8');
  for (const l of linksOf(html)) {
    liveLinks++;
    const target = path.resolve(path.dirname(f), l.href);
    if (!fs.existsSync(target)) {
      brokenLinks.push(rel(f) + ' → 缺文件 ' + rel(target));
      continue;
    }
    if (hashOf(fs.readFileSync(target, 'utf8')) !== l.hash) {
      brokenLinks.push(rel(f) + ' → ' + rel(target) + ' 内容 hash 不符');
    }
  }
}

/* ─────────── 输出 ─────────── */
console.log('文章页 ' + s.pages.length + ' 篇 · 内联 CSS 去重后 ' + s.groups.size + ' 种');
console.log('共享 link ' + liveLinks + ' 处 · 完整 ' + (liveLinks - brokenLinks.length) + ' · 损坏 ' + brokenLinks.length);
console.log('重复分组 ' + s.repeatHashes.size + ' 种 → 生成 ' + targets.size + ' 个共享 CSS 文件');
console.log('主模板 CSS = ' + s.commonHash + ' → post/article-common.css');
console.log('需替换文章页 ' + changes.length + ' 篇（共 ' + changes.reduce((a, c) => a + c.n, 0) + ' 处 style 块）');
console.log('需写入 CSS 文件 ' + cssWrites.length + ' 个' + (skipped.length ? '，带属性 style 跳过 ' + skipped.length + ' 处' : ''));

if (doDry) {
  for (const c of changes.slice(0, 8)) console.log('  · ' + rel(c.file) + ' ×' + c.n);
  if (changes.length > 8) console.log('  · …其余 ' + (changes.length - 8) + ' 篇');
  process.exit(0);
}

if (doCheck) {
  const need = changes.length + cssWrites.length + brokenLinks.length;
  console.log(need ? '✗ 需更新 ' + need + ' 处，请先执行本脚本或从版本库恢复共享 CSS' : '✓ 已幂等，无需更新');
  process.exit(need ? 1 : 0);
}

if (brokenLinks.length) {
  for (const b of brokenLinks.slice(0, 10)) console.error('  ✗ ' + b);
  console.error('共享 CSS 文件被改动或缺失，内容已无法从 HTML 反推，请从版本库恢复后再执行。');
  process.exit(1);
}

/* ─────────── 落盘 ─────────── */
if (!fs.existsSync(SHARED)) fs.mkdirSync(SHARED, { recursive: true });
for (const w of cssWrites) {
  fs.writeFileSync(w.file, targets.get(w.file), 'utf8');
  console.log('  + ' + rel(w.file) + ' · ' + w.bytes + ' B');
}
for (const c of changes) fs.writeFileSync(c.file, c.next, 'utf8');
console.log('✅ 已替换 ' + changes.length + ' 篇，共享 CSS 就绪');

/* 顺带提示：common 文件路径本身也是 build-article.cjs 的模板来源 */
if (fs.existsSync(COMMON)) {
  console.log('模板页现在是：' + rel(path.join(ROOT, 'post', 'dy-20261021-skill-top20', 'dy-20261021-skill-top20.html')));
}
