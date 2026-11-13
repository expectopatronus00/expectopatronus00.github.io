#!/usr/bin/env node
/**
 * 文章内联 CSS 共享层 —— 唯一实现，供 apply-shared-css.cjs 与 repo-lint.cjs 共用。
 *
 * 背景：153 篇文章页的内联 <style> 合计 1.39 MB，但去重后只有 46 种内容，
 * 其中 12 种被多篇复用（116 处）。把重复的那几份抽成外部 CSS，浏览器就能跨文章
 * 复用缓存，HTML 也瘦下来。CSS 内容零 url() / @import / @font-face，因此换位置
 * 不会让相对资源失效；link 原位替换 style，层叠顺序也完全不变。
 *
 * 约定：
 *   - 出现次数最多的一组固化成 post/article-common.css（它就是 build-article.cjs
 *     用的模板 CSS），其余重复组放 post/_shared/<hash>.css。
 *   - 只抽「出现 >= 2 次」的组；每篇独有的 CSS 保留内联，避免多一次无收益请求。
 *   - 共享文件的内容与 <style> 内部文本字节一致，因此 --revert 可无损还原。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const POST = path.join(ROOT, 'post');
const SHARED = path.join(POST, '_shared');
const COMMON = path.join(POST, 'article-common.css');
const HASH_LEN = 10;

const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const LINK_RE = /<link\b[^>]*data-shared-css="[^"]+"[^>]*\/?\s*>/gi;
const MARK = 'data-shared-css';

function hashOf(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, HASH_LEN);
}

/** 递归列出 post/ 下所有 .html 文章页（与 repo-lint 的口径一致）。 */
function walkPosts(dir = POST, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPosts(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

/** 取一个文件里所有 <style> 块，返回 { full, css, hash }。 */
function stylesOf(html) {
  const re = new RegExp(STYLE_RE.source, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ full: m[0], css: m[1], hash: hashOf(m[1]) });
  }
  return out;
}

/** 取一个文件里所有共享层 link，返回 { full, hash, href }。 */
function linksOf(html) {
  const re = new RegExp(LINK_RE.source, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const hash = (m[0].match(/data-shared-css="([^"]+)"/) || [])[1] || '';
    const href = (m[0].match(/href="([^"]+)"/) || [])[1] || '';
    out.push({ full: m[0], hash, href });
  }
  return out;
}

function relHref(fromHtmlFile, targetCssFile) {
  return path.relative(path.dirname(fromHtmlFile), targetCssFile).split(path.sep).join('/');
}

function cssFileFor(hash, commonHash) {
  return hash === commonHash ? COMMON : path.join(SHARED, hash + '.css');
}

function linkTag(fromHtmlFile, hash, commonHash) {
  const href = relHref(fromHtmlFile, cssFileFor(hash, commonHash));
  return '<link rel="stylesheet" href="' + href + '" ' + MARK + '="' + hash + '" />';
}

/**
 * 统计所有文章页的内联 CSS 分组。
 * 返回 { groups: Map<hash, {count, css, files}>, pages, commonHash, repeatHashes }
 */
function survey(files = walkPosts()) {
  const groups = new Map();
  const pages = [];
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    const styles = stylesOf(html);
    pages.push({ file: f, html, styles });
    for (const s of styles) {
      if (!groups.has(s.hash)) groups.set(s.hash, { count: 0, css: s.css, files: [] });
      const g = groups.get(s.hash);
      g.count++;
      g.files.push(f);
    }
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  const commonHash = ranked.length && ranked[0][1].count >= 2 ? ranked[0][0] : null;
  const repeatHashes = new Set(
    ranked.filter(([, g]) => g.count >= 2).map(([h]) => h)
  );
  return { groups, pages, ranked, commonHash, repeatHashes };
}

module.exports = {
  ROOT, POST, SHARED, COMMON, MARK,
  STYLE_RE, LINK_RE,
  hashOf, walkPosts, stylesOf, linksOf, relHref, cssFileFor, linkTag, survey,
};
