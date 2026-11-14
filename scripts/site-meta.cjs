/**
 * scripts/site-meta.cjs · 静态页 SEO 配置的唯一实现
 * ---------------------------------------------------------------------------
 * 文章页的 SEO 由 apply-seo-meta.cjs 按目录扫描；静态页没有目录规律，
 * 也不能靠猜——这里显式列出「允许被索引」的页面及其 canonical 路径，
 * 供 apply-site-meta.cjs 和 repo-lint.cjs 共用，避免两处各写一份清单。
 *
 * 为什么是 5 页而不是 7 页：
 *   · 404.html               已有 noindex，给它 canonical 会给爬虫错误信号
 *   · nav/stars/index.html   noindex + meta refresh 跳转页，已把 canonical
 *                            指向真正的星标榜，不需要再注入一份
 *   · 三个 template.html     是带占位符的渲染模板，不是线上页面；
 *                            把 @TITLE@ 写进 JSON-LD 会产出脏数据
 *
 * canonical 路径与 sitemap.xml 的 <loc> 逐字对齐（首页是根 `/`，不是
 * `/index.html`），lint 会读 sitemap 反向校验，防止两处漂移。
 */

'use strict';

const path = require('path');
const { siteUrl, readMeta } = require('./seo-meta.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_IMAGE = '/home/og-default.jpg';

const PAGES = [
  { file: 'index.html', path: '/', schemaType: 'WebSite' },
  { file: 'home/home.html', path: '/home/home.html', schemaType: 'CollectionPage' },
  { file: 'home/series.html', path: '/home/series.html', schemaType: 'CollectionPage' },
  { file: 'home/about.html', path: '/home/about.html', schemaType: 'AboutPage' },
  { file: 'nav/index.html', path: '/nav/index.html', schemaType: 'CollectionPage' },
];

/* 这两页必须保持 noindex：注入脚本不碰它们，lint 负责盯住。 */
const NOINDEX_PAGES = ['404.html', 'nav/stars/index.html'];

function fileOf(page) {
  return path.join(ROOT, page.file);
}

/** 从页面自身读取 title / description，保证 og:* 与 <title> / meta 不打架。 */
function buildMeta(page, html) {
  const parsed = readMeta(html, {});
  const title = parsed.title
    .replace(/\s*·\s*(?:EXPECTOPATRONUS|expectopatronus)\s*$/i, '')
    .trim() || parsed.title;
  return {
    pageUrl: siteUrl() + page.path,
    title,
    description: parsed.description,
    imageUrl: siteUrl() + DEFAULT_IMAGE,
    type: 'website',
    schemaType: page.schemaType,
  };
}

module.exports = { ROOT, PAGES, NOINDEX_PAGES, DEFAULT_IMAGE, fileOf, buildMeta };
