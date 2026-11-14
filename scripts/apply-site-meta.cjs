#!/usr/bin/env node
/**
 * scripts/apply-site-meta.cjs
 * ─────────────────────────────────────────────────────────────────────────
 * 给 5 个生产静态页幂等注入 canonical / og:* / twitter:card / JSON-LD。
 * 实现复用 seo-meta.cjs（type='website'），页面清单复用 site-meta.cjs。
 * 只动 <head>，正文一个字不改。
 *
 * 用法：
 *   node scripts/apply-site-meta.cjs           # 注入（幂等）
 *   node scripts/apply-site-meta.cjs --dry     # 只报告
 *   node scripts/apply-site-meta.cjs --check  # 有缺口时退出码 1
 *   node scripts/apply-site-meta.cjs --show   # 打印首页注入结果
 *   node scripts/apply-site-meta.cjs --revert # 移除注入内容
 *
 * build-index.cjs 在收尾链路里会自动调用本脚本，
 * 因此新建静态页后不用手工补跑。
 */

'use strict';

const fs = require('fs');
const { stripSeo, injectSeo, BEGIN } = require('./seo-meta.cjs');
const { PAGES, fileOf, buildMeta } = require('./site-meta.cjs');

const DRY = process.argv.includes('--dry');
const CHECK = process.argv.includes('--check');
const SHOW = process.argv.includes('--show');
const REVERT = process.argv.includes('--revert');

const changed = [];
const missing = [];
let sample = '';

for (const page of PAGES) {
  const file = fileOf(page);
  if (!fs.existsSync(file)) {
    missing.push(page.file);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  if (html.search(/<\/head>/i) < 0) {
    missing.push(page.file + '（无 </head>）');
    continue;
  }

  if (REVERT) {
    const out = stripSeo(html);
    if (out !== html) {
      if (!DRY) fs.writeFileSync(file, out, 'utf8');
      changed.push(page.file);
    }
    continue;
  }

  const out = injectSeo(html, buildMeta(page, html));
  if (out !== html) {
    if (!DRY && !CHECK) fs.writeFileSync(file, out, 'utf8');
    changed.push(page.file);
    if (!sample && page.file === 'index.html') {
      const end = out.indexOf('<!-- seo:end -->');
      sample = out.slice(Math.max(0, out.indexOf(BEGIN) - 100), end + 20);
    }
  }
}

if (REVERT) {
  console.log((DRY ? '[dry] ' : '') + '已移除静态页 SEO 块 ' + changed.length + ' 处 / 共 ' + PAGES.length + ' 页');
} else if (CHECK || DRY) {
  console.log('共 ' + PAGES.length + ' 个静态页，需更新 ' + changed.length + ' 个，缺失 ' + missing.length + ' 个');
  for (const f of changed) console.log('  - ' + f);
} else {
  console.log('共 ' + PAGES.length + ' 个静态页：新注入/更新 ' + changed.length + ' 个，已是最新 ' + (PAGES.length - changed.length - missing.length) + ' 个');
  for (const f of changed) console.log('  + ' + f);
}
for (const f of missing) console.log('  ! ' + f);
if (SHOW && sample) console.log('\n───── 首页注入样例 ─────\n' + sample);
if ((CHECK && (changed.length || missing.length)) || missing.length) process.exit(1);
