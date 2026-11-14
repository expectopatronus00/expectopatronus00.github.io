#!/usr/bin/env node
/**
 * scripts/seo-meta.cjs
 * ─────────────────────────────────────────────────────────────────────────
 * 全站页级 SEO 元数据的唯一实现。build-article.cjs（新稿）、
 * apply-seo-meta.cjs（存量文章）与 apply-site-meta.cjs（静态页）都 require
 * 本文件，避免三处逻辑漂移。
 *
 * 产出统一放在 <!-- seo:begin --> … <!-- seo:end --> 之间，便于幂等重跑、
 * --revert 和 repo-lint 校验。块内只写「可控项」：canonical、og:url、
 * og:site_name、og:image、twitter:card、JSON-LD；已有的 description /
 * og:title / og:description / og:type 保持原样，缺了才补。
 *
 * meta.type 默认 'article'（BlogPosting + og:type=article + datePublished）；
 * 传 'website' 则按 meta.schemaType 生成 WebSite / CollectionPage /
 * AboutPage 等结构化数据，且不写发布日期——静态页没有发布日期。
 *
 * 只依赖 node 内置模块，不引入构建步骤。站点根地址取 SITE_URL 环境变量。
 */

'use strict';

const DEFAULT_SITE = 'https://expectopatronus00.github.io';
const SITE_NAME = 'EXPECTOPATRONUS';
const AUTHOR = 'expectopatronus';
const BEGIN = '<!-- seo:begin -->';
const END = '<!-- seo:end -->';

function siteUrl() {
  return (process.env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, '');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/* 从 <meta …> 标签里取 content，兼容跨行写法与单双引号 */
function tagContent(html, tagRe) {
  const tag = html.match(tagRe);
  if (!tag) return null;
  const m = tag[0].match(/content\s*=\s*"([^"]*)"/i) || tag[0].match(/content\s*=\s*'([^']*)'/i);
  return m ? decodeHtml(m[1]) : null;
}

function metaOf(html, attrName, value) {
  return tagContent(html, new RegExp('<meta[^>]*' + attrName + '\\s*=\\s*["\']' + value + '["\'][^>]*>', 'i'));
}

/** 移除本脚本产出的块与受管标签，返回干净的 html（幂等 / revert 用） */
function stripSeo(html) {
  const at = html.search(/<\/head>/i);
  if (at < 0) return html;
  let head = html.slice(0, at);
  const tail = html.slice(at);

  head = head.replace(
    new RegExp('[ \\t]*' + BEGIN + '[\\s\\S]*?' + END + '[ \\t]*\\r?\\n?', 'i'),
    '',
  );
  /* 行首 [ \t]* 一并吃掉：老文章里的 og:image 是多行写法，只删标签会留下
     多余缩进，把紧跟其后的 og:description 顶成奇怪的 8 空格。 */
  head = head
    .replace(/[ \t]*<link[^>]*rel=["']canonical["'][^>]*>[ \t]*\r?\n?/gi, '')
    .replace(/[ \t]*<meta[^>]*property=["']og:(?:url|image|site_name)["'][^>]*>[ \t]*\r?\n?/gi, '')
    .replace(/[ \t]*<meta[^>]*name=["']twitter:(?:card|title|description|image)["'][^>]*>[ \t]*\r?\n?/gi, '')
    .replace(/[ \t]*<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>[ \t]*\r?\n?/gi, '');

  return head + tail;
}

/**
 * 把 SEO 块注入 html 的 </head> 前。
 * meta: { pageUrl, title, description, date, imageUrl, type, schemaType }
 * 返回新 html；重复调用结果稳定（幂等）。
 */
function injectSeo(html, meta) {
  const clean = stripSeo(html);
  const at = clean.search(/<\/head>/i);
  if (at < 0) return html;

  const isArticle = (meta.type || 'article') !== 'website';
  const schemaType = isArticle ? 'BlogPosting' : (meta.schemaType || 'WebPage');
  const pageUrl = meta.pageUrl;
  const title = meta.title || '';
  const description = meta.description || '';
  const imageUrl = meta.imageUrl;
  const site = siteUrl();
  const rawDate = String(meta.date || '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  let head = clean.slice(0, at);
  const tail = clean.slice(at);

  const lines = [];
  const add = (s) => lines.push('    ' + s);

  /* 基础项：老模板可能缺，缺了才补，不覆盖原文 */
  if (!/<meta[^>]*name=["']description["']/i.test(head) && description) {
    add('<meta name="description" content="' + escapeHtml(description) + '" />');
  }
  if (!/<meta[^>]*property=["']og:title["']/i.test(head) && title) {
    add('<meta property="og:title" content="' + escapeHtml(title) + '" />');
  }
  if (!/<meta[^>]*property=["']og:type["']/i.test(head)) {
    add('<meta property="og:type" content="' + (isArticle ? 'article' : 'website') + '" />');
  }
  if (!/<meta[^>]*property=["']og:description["']/i.test(head) && description) {
    add('<meta property="og:description" content="' + escapeHtml(description) + '" />');
  }

  add('<link rel="canonical" href="' + escapeHtml(pageUrl) + '" />');
  add('<meta property="og:url" content="' + escapeHtml(pageUrl) + '" />');
  add('<meta property="og:site_name" content="' + SITE_NAME + '" />');
  add('<meta property="og:image" content="' + escapeHtml(imageUrl) + '" />');
  add('<meta name="twitter:card" content="summary_large_image" />');

  const ld = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    headline: title,
    description: description,
    image: imageUrl,
    inLanguage: 'zh-CN',
    author: { '@type': 'Person', name: AUTHOR, url: site },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: site },
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
  };
  if (isArticle && date) {
    ld.datePublished = date;
    ld.dateModified = date;
  }
  /* 防止标题里出现 </script> 提前闭合脚本标签 */
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  add('<script type="application/ld+json">' + json + '</script>');

  /* 保留 </head> 原有的行首缩进，块结束后再还回去 */
  const indent = (head.match(/[ \t]*$/) || [''])[0];
  head = head.replace(/[ \t]*$/, '');
  if (!head.endsWith('\n')) head += '\n';
  return head + '    ' + BEGIN + '\n' + lines.join('\n') + '\n    ' + END + '\n' + indent + tail;
}

/** 从现有文章 HTML 里解析出注入所需的元数据 */
function readMeta(html, fallback) {
  const fb = fallback || {};
  const ogTitle = metaOf(html, 'property', 'og:title');
  const desc = metaOf(html, 'name', 'description') || metaOf(html, 'property', 'og:description');
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const title = ogTitle || (titleTag ? decodeHtml(titleTag).replace(/\s*·\s*EXPECTOPATRONUS\s*$/i, '') : '') ||
    (h1 ? decodeHtml(h1.replace(/<[^>]+>/g, '')).trim() : '') || fb.title || '';
  const dateInHtml = (html.match(/\b(20\d{2}-\d{2}-\d{2})\b/) || [])[1];
  return {
    title: title.trim(),
    description: (desc || fb.description || '').trim(),
    date: fb.date || dateInHtml || null,
  };
}

module.exports = {
  siteUrl,
  escapeHtml,
  decodeHtml,
  stripSeo,
  injectSeo,
  readMeta,
  BEGIN,
  END,
  DEFAULT_SITE,
};
