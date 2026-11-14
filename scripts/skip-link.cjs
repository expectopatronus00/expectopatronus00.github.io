/**
 * scripts/skip-link.cjs · 全站「跳到主要内容」链接的唯一实现
 * ---------------------------------------------------------------------------
 * 解决 WCAG 2.4.1（Bypass Blocks）：键盘用户 Tab 第一下应该能跳过顶部
 * 导航，而不是把 site-nav 里的每个链接都走一遍。P3 体检时 8/8 页都没有
 * 跳过机制。
 *
 * 产出两处纯 HTML 改动，不依赖 JS（首页刚做完无 JS 静态兜底，不能倒退）：
 *   1. <body> 开头一个 a.skip-link[href="#main-content"]，包在注释块里
 *   2. 主内容开标签上补 id / tabindex / data-skip-target="1"
 *      优先 <main>，没有 <main> 的 164 页取 </nav> 后第一个块级标签
 *      （实测是 header.hero 或 section.page-intro），只加属性不改标签结构，
 *      所以对层叠、闭合配对、布局都是零风险。
 *
 * nav/index.html 原本就有 id="main-content"（列表渲染容器），复用它，
 * 只补 tabindex 与标记；stripSkip 靠 data-skip-target 精确定位注入内容，
 * 不会把原有的 id 一起删掉。
 *
 * 样式在 home/design-tokens.css 末尾（A11Y · SKIP LINK 区块），
 * 全站页面都引用该文件；用 html body 前缀保证压过页面内联样式。
 */

'use strict';

const BEGIN = '<!-- skip-link:begin -->';
const END = '<!-- skip-link:end -->';
const TARGET_ID = 'main-content';
const MARK = 'data-skip-target="1"';
const LINK = '<a class="skip-link" href="#' + TARGET_ID + '">跳到主要内容</a>';

/* 注入的属性串必须连续，stripSkip 才能精确还原 */
const ATTR_RE = / data-skip-target="1"(?: tabindex="-1")?(?: id="main-content")?/g;

/** 移除注入内容（幂等 / --revert 用）。 */
function stripSkip(html) {
  return html
    .replace(new RegExp('[ \\t]*' + BEGIN + '[\\s\\S]*?' + END + '[ \\t]*\\r?\\n?', 'i'), '')
    .replace(ATTR_RE, '');
}

/** 读回注入块，供 lint 校验。 */
function readSkip(html) {
  const b = html.indexOf(BEGIN);
  const e = html.indexOf(END, b < 0 ? 0 : b);
  return b < 0 || e < 0 ? null : html.slice(b, e + END.length);
}

/**
 * 找主内容开标签。先把 HTML 注释替换成等长空格，避免注释里的示例标签
 * 被误当成锚点；等长替换保证后面的下标仍然对得上原字符串。
 */
function anchorTag(html) {
  const body = /<body\b[^>]*>/i.exec(html);
  if (!body) return null;
  const from = body.index + body[0].length;
  const masked = html.slice(0, from) +
    html.slice(from).replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));

  const main = /<main\b[^>]*>/i.exec(masked.slice(from));
  if (main) return { index: from + main.index, tag: main[0] };

  const navEnd = masked.toLowerCase().indexOf('</nav>', from);
  const start = navEnd >= 0 ? navEnd + 6 : from;
  const m = /<(?:header|section|article|div|main)\b[^>]*>/i.exec(masked.slice(start));
  return m ? { index: start + m.index, tag: m[0] } : null;
}

/** 注入（或替换）skip-link；重复调用结果稳定。 */
function injectSkip(html) {
  const clean = stripSkip(html);
  const anchor = anchorTag(clean);
  if (!anchor) return clean;

  const hasId = /\bid\s*=\s*["']main-content["']/i.test(anchor.tag);
  const hasTab = /\btabindex\s*=/i.test(anchor.tag);
  let attrs = ' ' + MARK;
  if (!hasTab) attrs += ' tabindex="-1"';
  if (!hasId) attrs += ' id="' + TARGET_ID + '"';

  const selfClose = /\/>$/.test(anchor.tag);
  const pos = anchor.index + anchor.tag.length - (selfClose ? 2 : 1);
  const withAnchor = clean.slice(0, pos) + attrs + clean.slice(pos);

  const body = /<body\b[^>]*>/i.exec(withAnchor);
  if (!body) return clean;
  const at = body.index + body[0].length;
  const block = '\n    ' + BEGIN + '\n    ' + LINK + '\n    ' + END;
  return withAnchor.slice(0, at) + block + withAnchor.slice(at);
}

module.exports = { BEGIN, END, TARGET_ID, MARK, LINK, stripSkip, readSkip, anchorTag, injectSkip };
