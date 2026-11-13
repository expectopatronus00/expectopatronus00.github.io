#!/usr/bin/env node
/**
 * 幂等补齐全站 <img> 属性，并把有 webp 伴生的封面升级成 <picture>。
 *
 *   node scripts/apply-image-attrs.cjs --dry     预览
 *   node scripts/apply-image-attrs.cjs           执行
 *   node scripts/apply-image-attrs.cjs --check   只检查是否还需更新（CI 用）
 *
 * 规则：
 *   - 本地图片：从文件头读出真实尺寸，补 width / height（防 CLS）；站外图片尺寸未知，
 *     不写假值，只补 decoding="async"（它们的容器本来就有 max-width:100% 约束）。
 *   - 所有 img 补 decoding="async"；已有的 loading / alt / width / height 一律保留。
 *   - 文章封面（src=cover.jpg 且同目录有 cover.webp）包一层 picture，
 *     webp 给现代浏览器、jpg 给 fallback；og:image 仍是 jpg，社交平台兼容性不变。
 *   - 用 data-cover-ready 标记保证重复执行不会二次包裹。
 *   - 清理存量遗留的 src="" 空封面：没有任何 JS 会填充它，浏览器只会渲染成破图 + alt 文字。
 *     空的 .hero-image 整块移除；CTA 的 .cover 是 grid 首列，删掉后给 .cta-box 打标记，
 *     由 post/article-read.css 收成单列，避免内容被挤进窄列。
 *
 * 本文件同时作为「本地图片判定」的唯一实现：repo-lint.cjs 直接 require resolveLocal()，
 * 避免 lint 与修复脚本口径漂移（曾经的坑：src="" 被解析成目录，误报 47 项）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.tools', 'node_modules', '.git', '_ab_before']);
const IMG_RE = /<img\b[^>]*>/gi;

function walkHtml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkHtml(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

function rel(f) { return path.relative(ROOT, f).replace(/\\/g, '/'); }

/** 从文件头读图片尺寸，支持 PNG / JPEG / SVG，读不出返回 null。 */
function imageSize(file) {
  let b;
  try { b = fs.readFileSync(file); } catch (_e) { return null; }
  if (b.length > 24 && b.slice(1, 4).toString() === 'PNG') {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length > 10 && b[0] === 0xff && b[1] === 0xd8) {
    const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      if (SOF.has(b[i + 1])) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      const len = b.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }
  if (/\.svg$/i.test(file)) {
    const s = b.toString('utf8');
    const w = s.match(/\bwidth=["']([\d.]+)/), h = s.match(/\bheight=["']([\d.]+)/);
    if (w && h) return { w: Math.round(+w[1]), h: Math.round(+h[1]) };
    const vb = s.match(/viewBox=["']([\d.\s,-]+)["']/);
    if (vb) {
      const p = vb[1].trim().split(/[\s,]+/).map(Number);
      if (p.length === 4) return { w: Math.round(p[2]), h: Math.round(p[3]) };
    }
  }
  return null;
}

function hasAttr(tag, name) {
  return new RegExp('\\b' + name + '\\s*=').test(tag);
}

function addAttr(tag, name, value) {
  if (hasAttr(tag, name)) return tag;
  const m = tag.match(/^(<img\b[^>]*?)(\s*\/?>)$/i);
  if (!m) return tag;
  const selfClose = m[2].trim().startsWith('/');
  return m[1] + ' ' + name + '="' + value + '"' + (selfClose ? ' />' : '>');
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
  return m ? m[1] : null;
}

/**
 * 解析出「真实的本地图片文件」绝对路径；不是本地图片一律返回 null。
 *
 * 明确排除：
 *   - src 为空/纯空白（遗留占位图，运行时也没有脚本填充，浏览器只显示破图）
 *   - 站外 URL / data: / 协议相对 URL
 *   - 模板占位符 @COVER@（出现在 scripts 与 skills 下的 HTML 模板里）
 *   - 解析结果是目录、或文件不存在
 *
 * 最后一条特别重要：src="" 时 path.resolve(dirname, '') 会返回「目录本身」，
 * fs.existsSync() 为 true，早期版本因此把 47 个占位 img 误计成待补尺寸的本地图片。
 */
function resolveLocal(htmlFile, src) {
  const s = String(src == null ? '' : src).trim();
  if (!s || /^(https?:|data:|\/\/)/i.test(s)) return null;
  if (/^@.+@$/.test(s)) return null;
  const cleaned = s.split(/[?#]/)[0];
  const file = cleaned.startsWith('/')
    ? path.join(ROOT, cleaned.replace(/^\/+/, ''))
    : path.resolve(path.dirname(htmlFile), cleaned);
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch (_e) {
    return null;
  }
  return file;
}

const EMPTY_SRC_IMG = /<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>/i;
const HERO_EMPTY = /[ \t]*<div class="hero-image">\s*<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>\s*<\/div>[ \t]*\r?\n?/gi;
const CTA_EMPTY = /(<div\b[^>]*class="[^"]*\bcta-box\b[^"]*"[^>]*>)(\s*)([ \t]*<div class="cover">\s*<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>\s*<\/div>[ \t]*\r?\n?)/gi;

/**
 * 删除「容器里只有一张空 src 图片」的块。
 * 只处理这两种已知形态，不碰任何带真实 src 的图片，也不碰正文里的其它 img。
 */
function stripEmptyImages(html) {
  let removed = 0;
  let out = html.replace(CTA_EMPTY, (_m, open, ws) => {
    removed++;
    if (!/\bdata-no-cover\s*=/.test(open)) {
      open = open.replace(/\s*>$/, ' data-no-cover="1">');
    }
    return open + ws;
  });
  out = out.replace(HERO_EMPTY, () => { removed++; return ''; });
  return { next: out, removed };
}

function processHtml(htmlFile, html) {
  const stats = { imgs: 0, sized: 0, decoding: 0, pictures: 0, external: 0, emptyRemoved: 0 };
  const stripped = stripEmptyImages(html);
  stats.emptyRemoved = stripped.removed;
  const next = stripped.next.replace(new RegExp(IMG_RE.source, 'gi'), (tag) => {
    stats.imgs++;
    const src = attr(tag, 'src');
    const local = resolveLocal(htmlFile, src);
    let out = tag;

    if (local) {
      const size = imageSize(local);
      if (size && (!hasAttr(tag, 'width') || !hasAttr(tag, 'height'))) {
        out = addAttr(addAttr(out, 'width', String(size.w)), 'height', String(size.h));
        stats.sized++;
      }
    } else if (/^(https?:|\/\/)/i.test(src || '')) {
      stats.external++;
    }

    if (!hasAttr(tag, 'decoding')) { out = addAttr(out, 'decoding', 'async'); stats.decoding++; }

    /* 封面升级：只在同目录已有 webp 时做，避免 <source> 指向 404 */
    const isCover = src && /(^|\/)cover\.jpg$/i.test(src) && local;
    const webp = isCover ? local.replace(/\.jpg$/i, '.webp') : null;
    if (webp && fs.existsSync(webp) && !hasAttr(tag, 'data-cover-ready')) {
      out = addAttr(out, 'data-cover-ready', '1');
      out = '<picture data-cover-picture="1">\n' +
        '        <source srcset="cover.webp" type="image/webp" />\n' +
        '        ' + out + '\n' +
        '      </picture>';
      stats.pictures++;
    }
    return out;
  });
  return { next, stats };
}

module.exports = {
  ROOT, SKIP_DIRS, IMG_RE, EMPTY_SRC_IMG,
  walkHtml, rel, imageSize, hasAttr, addAttr, attr,
  resolveLocal, stripEmptyImages, processHtml,
};

/* ─────────── CLI ─────────── */
if (require.main === module) {
  const args = process.argv.slice(2);
  const doCheck = args.includes('--check');
  const doDry = args.includes('--dry');
  const files = walkHtml(ROOT);
  const total = { imgs: 0, sized: 0, decoding: 0, pictures: 0, external: 0, emptyRemoved: 0 };
  const changed = [];

  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    const r = processHtml(f, html);
    for (const k of Object.keys(total)) total[k] += r.stats[k];
    if (r.next !== html) changed.push({ file: f, next: r.next });
  }

  console.log('扫描 HTML ' + files.length + ' 个 · <img> ' + total.imgs + ' 个（站外 ' + total.external + '）');
  console.log('可补 width/height ' + total.sized + ' 个 · 可补 decoding ' + total.decoding + ' 个 · 可升级 picture ' + total.pictures + ' 个 · 清理空封面 ' + total.emptyRemoved + ' 个');
  console.log('需更新文件 ' + changed.length + ' 个');

  if (doDry) {
    for (const c of changed.slice(0, 8)) console.log('  · ' + rel(c.file));
    if (changed.length > 8) console.log('  · …其余 ' + (changed.length - 8) + ' 个');
    process.exit(0);
  }
  if (doCheck) {
    console.log(changed.length ? '✗ 仍有 ' + changed.length + ' 个文件需更新' : '✓ 图片属性、picture 与空封面清理已全部就位');
    process.exit(changed.length ? 1 : 0);
  }
  for (const c of changed) fs.writeFileSync(c.file, c.next, 'utf8');
  console.log('✅ 已更新 ' + changed.length + ' 个文件');
}
