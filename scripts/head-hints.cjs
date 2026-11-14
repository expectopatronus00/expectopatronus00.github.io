/**
 * head-hints.cjs · 全站 <head> 提示层的唯一实现
 * ---------------------------------------------------------------------------
 * 产出三样东西，包在 <!-- head-hints:begin --> … <!-- head-hints:end --> 里：
 *
 *   1. <meta name="theme-color">       浏览器 UI 跟随站点主题（不是跟随系统配色）
 *   2. preconnect / dns-prefetch       fonts.css 里 @import 的 emfont CDN
 *   3. <script src="/home/theme-color.js" defer>  主题切换时同步 theme-color
 *
 * 为什么需要脚本：本站是 data-theme 手动切换的双主题站，纯 media 查询的
 * theme-color 只在系统配色变化时生效，用户点主题按钮时不会跟着变。
 * 脚本的颜色取自 design-tokens.css 的 --bg，不在 JS 里另写一份色值。
 *
 * 站点是 GitHub Pages user site，根路径即 /，所以脚本用绝对路径；
 * 404.html 会在任意路径下被返回，相对路径会失效。
 *
 * 用法：
 *   const { injectHints, stripHints, readHints, walkPages, cssBg } = require('./head-hints.cjs');
 *
 * 唯一实现原则：build-article.cjs 直接调用 injectHints，
 * apply-head-hints.cjs 批量补存量，repo-lint.cjs 校验覆盖率，三处不各自拼字符串。
 */

const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- head-hints:begin -->';
const END = '<!-- head-hints:end -->';

const FONT_ORIGIN = 'https://font.emtech.cc';
const FA_ORIGIN = 'https://cdnjs.cloudflare.com';
const THEME_SCRIPT = '/home/theme-color.js';

/* 排除项：抓取缓存、AI 记忆、A/B 临时目录、依赖目录都不是生产页面。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.tools', '.workbuddy-ai', '_ab_before']);

/** 遍历所有需要 head hints 的 HTML（含 3 个模板：从模板生成的新页会自带 hints）。 */
function walkPages(root) {
  const out = [];
  (function rec(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) rec(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.html')) {
        out.push(path.join(dir, entry.name));
      }
    }
  })(root);
  return out;
}

/**
 * 从 design-tokens.css 读主题底色，作为静态 meta 的默认值。
 * 返回 { dark, light }，读不到时给保守兜底，但 lint 会校验 CSS 里确有这两个值。
 */
function cssBg(root = path.resolve(__dirname, '..')) {
  const p = path.join(root, 'home', 'design-tokens.css');
  const css = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const pick = (name) => {
    const m = css.match(new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;'));
    return m ? m[1].toLowerCase() : null;
  };
  return {
    dark: pick('ink-950') || '#0b0d16',
    light: pick('paper') || '#f4efe4',
    cssFound: !!(pick('ink-950') && pick('paper')),
  };
}

/**
 * 页面是否真的外链了 FontAwesome CSS。
 * 只认 rel="stylesheet"：否则会把自己注入的 preconnect 也算进来，
 * 变成「有 preconnect 所以判定需要 preconnect」的自证循环。
 * 逐标签扫而不是单行正则——存量页里不少 link 标签是跨行写的。
 */
function needsFa(html) {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    if (/\bhref\s*=\s*["']https:\/\/cdnjs\.cloudflare\.com/i.test(tag)) return true;
  }
  return false;
}

function hintsBlock(html, darkBg) {
  const lines = [
    BEGIN,
    '<meta name="theme-color" content="' + darkBg + '" />',
    '<link rel="preconnect" href="' + FONT_ORIGIN + '" crossorigin />',
    '<link rel="dns-prefetch" href="' + FONT_ORIGIN + '" />',
  ];
  if (needsFa(html)) {
    lines.push('<link rel="preconnect" href="' + FA_ORIGIN + '" crossorigin />');
  }
  lines.push(
    '<script src="' + THEME_SCRIPT + '" defer></script>',
    END
  );
  return lines;
}

/** 去掉旧的 hints 块（幂等 / --revert 用）。 */
function stripHints(html) {
  const b = html.indexOf(BEGIN);
  if (b < 0) return html;
  const e = html.indexOf(END, b);
  if (e < 0) return html;
  let from = b;
  const lineStart = html.lastIndexOf('\n', b);
  if (lineStart >= 0 && /^[ \t]*$/.test(html.slice(lineStart + 1, b))) from = lineStart + 1;
  let to = e + END.length;
  if (html[to] === '\n') to += 1;
  return html.slice(0, from) + html.slice(to);
}

/** 读回 hints 块内容，供 lint 校验。 */
function readHints(html) {
  const b = html.indexOf(BEGIN);
  const e = html.indexOf(END, b < 0 ? 0 : b);
  if (b < 0 || e < 0) return null;
  return html.slice(b, e + END.length);
}

/**
 * 注入（或替换）hints 块。
 * 位置：charset meta 之后、第一个 stylesheet 之前——preconnect 要在 CSS 开始加载前
 * 就发出去才有意义；charset 保持在 head 最前面以符合编码嗅探规则。
 */
function injectHints(html, darkBg = cssBg().dark) {
  const clean = stripHints(html);
  const headOpen = clean.match(/<head\b[^>]*>/i);
  if (!headOpen) return clean;
  const headStart = headOpen.index + headOpen[0].length;
  const headEnd = clean.toLowerCase().indexOf('</head>', headStart);
  if (headEnd < 0) return clean;

  let anchor = headStart;
  const charset = clean.slice(headStart, headEnd).match(/<meta\s+charset\s*=\s*["'][^"']+["']\s*\/?\s*>/i);
  if (charset) anchor = headStart + charset.index + charset[0].length;

  const indented = hintsBlock(clean, darkBg).map((l) => '    ' + l).join('\n');
  return clean.slice(0, anchor) + '\n' + indented + clean.slice(anchor);
}

module.exports = {
  BEGIN, END, FONT_ORIGIN, FA_ORIGIN, THEME_SCRIPT,
  cssBg, walkPages, needsFa, hintsBlock, stripHints, readHints, injectHints,
};
