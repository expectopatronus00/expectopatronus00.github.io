#!/usr/bin/env node
/* ==========================================================================
   repo-lint.cjs — 仓库一致性检查
   检查 post/ 文章文件与前端页面显示的一致性
   使用: node scripts/repo-lint.cjs [--fix]
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ─────────── 工具函数 ─────────── */

function walk(dir, ext = '.html') {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) out = out.concat(walk(p, ext));
    else if (entry.endsWith(ext)) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

/* 从 home/articles.js 的 window.articles 数组提取对象数组（简化解析） */
function parseArticles(articlesJsContent) {
  // 定位 `window.articles = [`
  const m = articlesJsContent.match(/window\.articles\s*=\s*\[([\s\S]*?)\n\s*\](?=\s*[;,])/);
  if (!m) return [];
  const chunk = m[1];
  // 按 `,` 拆出每个对象（考虑花括号配对）
  const objects = [];
  let depth = 0, cur = '', inStr = false, strCh = '';
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (inStr) {
      cur += c;
      if (c === strCh && chunk[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; cur += c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      objects.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) objects.push(cur);

  return objects
    .map((o) => {
      const id = (o.match(/id\s*:\s*["']([^"']+)["']/) || [])[1];
      const title = (o.match(/title\s*:\s*["']([^"']+)["']/) || [])[1];
      const url = (o.match(/url\s*:\s*["']([^"']+)["']/) || [])[1];
      const category = (o.match(/category\s*:\s*["']([^"']+)["']/) || [])[1];
      return { id, title, url, category };
    })
    .filter((a) => a.id); // 过滤空对象
}

function extractDisplayNums(html) {
  const results = [];
  // home.html: "共 N 篇"
  const m1 = html.match(/共\s*(\d+)\s*篇/);
  if (m1) results.push({ location: 'home.html · "共 N 篇"', num: parseInt(m1[1]) });
  // index.html: articles hero
  const m2 = html.match(/(?:articles|内容库|内容总数)[\s\S]{0,60}?(\d+)/);
  if (m2) results.push({ location: 'index.html · hero articles', num: parseInt(m2[1]) });
  // index.html: hero 第一个 num div
  const m3 = html.match(/<div class="num">(\d+)<\/div>[\s\S]{0,60}articles/);
  if (m3) results.push({ location: 'index.html · hero first num', num: parseInt(m3[1]) });
  return results;
}

function printRow(label, value, pass) {
  const icon = pass === true ? '✅' : pass === false ? '❌' : pass === null ? '⏸' : 'ℹ';
  console.log(`  ${icon}  ${label.padEnd(36)}  ${value}`);
}

function printSection(title) {
  console.log(`\n━━━━━ ${title} ━━━━━`);
}

/* ─────────── 检查 1: 物理文件 vs articles 数组 ─────────── */

function checkPostCount() {
  printSection('文章数一致性');
  const postFiles = walk(path.join(ROOT, 'post'), '.html');
  const postCount = postFiles.length;

  const articlesJsPath = path.join(ROOT, 'home/articles.js');
  const articlesJsContent = fs.readFileSync(articlesJsPath, 'utf8');
  const articles = parseArticles(articlesJsContent);

  const homePath = path.join(ROOT, 'home/home.html');
  const homeHtml = fs.readFileSync(homePath, 'utf8');
  const displayMatch = homeHtml.match(/共\s*(\d+)\s*篇/);
  const displayNum = displayMatch ? parseInt(displayMatch[1]) : null;

  printRow('post/ 物理 html 文件数', postCount, true);
  printRow('articles.js articles 条目数', articles.length, true);
  printRow('home.html "共 N 篇" 显示', displayNum !== null ? displayNum : '未找到', true);

  let problems = [];
  if (postCount !== articles.length) {
    problems.push(`物理文件数 (${postCount}) ≠ articles 数组条目数 (${articles.length})`);
  }
  if (displayNum !== null && displayNum !== postCount) {
    problems.push(`显示数字 (${displayNum}) ≠ 实际文章数 (${postCount})`);
  }
  if (displayNum !== null && displayNum !== articles.length) {
    problems.push(`显示数字 (${displayNum}) ≠ articles 条目数 (${articles.length})`);
  }
  return { postCount, articles, displayNum, problems, homeHtml };
}

/* ─────────── 检查 2: 死链检测 ─────────── */

function checkDeadLinks(articles) {
  printSection('死链检测（articles → 物理文件）');
  const dead = [];
  for (const a of articles) {
    if (!a.url) continue;
    // articles 中写的是 "../post/xxx"（从 home/ 目录解析）
    const resolved = path.join(ROOT, 'home', a.url);
    if (!fs.existsSync(resolved)) {
      dead.push({ id: a.id, url: a.url });
    }
  }
  if (dead.length === 0) {
    console.log('  ✅  所有 articles 指向的 html 文件均存在');
  } else {
    for (const d of dead) {
      printRow(`死链 [${d.id}]`, d.url, false);
    }
  }
  return dead;
}

/* ─────────── 检查 3: 物理文件反查（存在但未在 articles 中） ─────────── */

function checkOrphanPosts(articles) {
  printSection('文章反查（有文件但没在 articles 里）');
  const articlePaths = new Set(articles.map((a) => {
    const p = path.join(ROOT, 'home', a.url);
    return rel(p);
  }));
  const postFiles = walk(path.join(ROOT, 'post'), '.html');
  const orphans = postFiles
    .map(rel)
    .filter((p) => !articlePaths.has(p));
  if (orphans.length === 0) {
    console.log('  ✅  所有 post/ 下的 html 文件都已在 articles 中列出');
  } else {
    for (const o of orphans) {
      printRow('未在 articles 中引用', o, false);
    }
  }
  return orphans;
}

/* ─────────── 检查 4: 重复 ID / 重复标题 ─────────── */

function checkDuplicates(articles) {
  printSection('重复检测');
  const byId = {};
  const byTitle = {};
  for (const a of articles) {
    (byId[a.id] = byId[a.id] || []).push(a);
    (byTitle[a.title] = byTitle[a.title] || []).push(a);
  }
  const dupIds = Object.entries(byId).filter(([, arr]) => arr.length > 1);
  const dupTitles = Object.entries(byTitle).filter(([, arr]) => arr.length > 1);
  if (dupIds.length === 0 && dupTitles.length === 0) {
    console.log('  ✅  无重复 ID，无重复标题');
    return { dupIds, dupTitles };
  }
  for (const [id, arr] of dupIds) {
    printRow(`重复 id [${id}]`, `共 ${arr.length} 条`, false);
  }
  for (const [title, arr] of dupTitles) {
    printRow(`重复标题 "${title}"`, `共 ${arr.length} 条 (可能是故意重复，人工确认)`, null);
  }
  return { dupIds, dupTitles };
}

/* ─────────── 检查 5: index.html hero 数字 ─────────── */

function checkIndexHero(postCount) {
  printSection('index.html hero 数字');
  const indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.log('  ⏸  未找到 index.html，跳过');
    return null;
  }
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  // 定位 hero-stats 标签后的第一个 <div class="num">N</div>
  const idx = indexHtml.indexOf('<div class="hero-stats">');
  if (idx === -1) {
    console.log('  ⏸  未找到 hero-stats 区块');
    return null;
  }
  const slice = indexHtml.substr(idx, 400);
  // 第一个 num div
  const m = slice.match(/<div class="num">(\d+)<\/div>/);
  if (!m) {
    console.log('  ⏸  hero-stats 中无数字，跳过');
    return null;
  }
  const heroNum = parseInt(m[1]);
  const pass = heroNum === postCount;
  printRow('index.html · hero articles', heroNum, pass);
  return { shouldBe: postCount, actual: heroNum };
}

/* ─────────── 检查 6: favicon 一致性 ─────────── */

function checkFaviconConsistency() {
  printSection('favicon 一致性');
  const htmlFiles = [
    ...walk(path.join(ROOT, 'post'), '.html'),
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'home/home.html'),
    path.join(ROOT, 'nav/index.html'),
    path.join(ROOT, 'skills/douyin-post-skill/template.html'),
  ].filter(fs.existsSync);
  let usesOldPng = 0;
  let usesSvg = 0;
  let others = 0;
  for (const f of htmlFiles) {
    const c = fs.readFileSync(f, 'utf8');
    if (/shortcut icon[^>]*50\.png/.test(c)) usesOldPng++;
    else if (/shortcut icon[^>]*logo\.svg/.test(c)) usesSvg++;
    else others++;
  }
  printRow('使用 logo.svg', `${usesSvg} 个文件`, true);
  if (usesOldPng > 0) printRow('仍使用 50.png (已弃)', `${usesOldPng} 个文件，需替换`, false);
  if (others > 0) printRow('其他 favicon', `${others} 个文件`, null);
  return { usesOldPng, usesSvg, others };
}

/* ─────────── 检查 7: 易读性样式覆盖率 ───────────
   共享样式 post/article-read.css 必须被每篇文章引用，否则新稿会退回
   文字墙排版。build-article.cjs 会自动带上，存量由 apply-read-css.cjs 补。 */
function checkReadCss() {
  printSection('易读性样式覆盖率');
  const files = walk(path.join(ROOT, 'post'), '.html');
  const missing = [];
  for (const f of files) {
    if (!/article-read\.css/.test(fs.readFileSync(f, 'utf8'))) missing.push(rel(f));
  }
  printRow('已接入 article-read.css', `${files.length - missing.length}/${files.length}`, missing.length === 0);
  for (const m of missing.slice(0, 10)) printRow('未接入', m, false);
  if (missing.length > 10) console.log(`  ℹ  另有 ${missing.length - 10} 个未接入`);
  if (missing.length === 0) console.log('  ✅  全部文章页已接入共享易读性样式');
  return missing;
}

/* ─────────── 检查 8: SEO 元数据覆盖率 ───────────
   canonical / og:image / twitter:card / JSON-LD 由 scripts/seo-meta.cjs 统一产出：
   新稿由 build-article.cjs 注入，存量由 apply-seo-meta.cjs 幂等补齐。
   顺带校验 JSON-LD 能解析、og:image 指向本站（防止带回退的站外签名图）。 */
function checkSeoMeta() {
  printSection('SEO 元数据覆盖率');
  const files = walk(path.join(ROOT, 'post'), '.html');
  const site = (process.env.SITE_URL || 'https://expectopatronus00.github.io').replace(/\/+$/, '');
  const issues = [];
  const ok = { canonical: 0, ogImage: 0, twitterCard: 0, jsonld: 0 };

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const at = src.search(/<\/head>/i);
    const head = at < 0 ? src : src.slice(0, at);
    const name = rel(f);
    const bad = (reason) => issues.push({ file: name, reason });

    if (/rel=["']canonical["']/i.test(head)) ok.canonical++;
    else bad('缺 canonical');

    const img = head.match(/<meta[^>]*property=["']og:image["'][^>]*>/i);
    if (img) {
      ok.ogImage++;
      const c = img[0].match(/content\s*=\s*["']([^"']+)["']/i);
      if (!c || c[1].indexOf(site + '/') !== 0) bad('og:image 不是本站地址');
    } else {
      bad('缺 og:image');
    }

    if (/name=["']twitter:card["']/i.test(head)) ok.twitterCard++;
    else bad('缺 twitter:card');

    const ld = head.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!ld) {
      bad('缺 JSON-LD');
    } else {
      try {
        const obj = JSON.parse(ld[1]);
        if (obj['@type'] !== 'BlogPosting' || !obj.headline || !obj.mainEntityOfPage ||
            !/^\d{4}-\d{2}-\d{2}$/.test(obj.datePublished || '')) {
          bad('JSON-LD 字段不全/缺日期');
        } else {
          ok.jsonld++;
        }
      } catch (e) {
        bad('JSON-LD 不是合法 JSON');
      }
    }
  }

  printRow('canonical', `${ok.canonical}/${files.length}`, ok.canonical === files.length);
  printRow('og:image（本站）', `${ok.ogImage}/${files.length}`, ok.ogImage === files.length);
  printRow('twitter:card', `${ok.twitterCard}/${files.length}`, ok.twitterCard === files.length);
  printRow('JSON-LD（可解析）', `${ok.jsonld}/${files.length}`, ok.jsonld === files.length);
  for (const i of issues.slice(0, 10)) printRow(i.reason, i.file, false);
  if (issues.length > 10) console.log(`  ℹ  另有 ${issues.length - 10} 项`);
  if (issues.length === 0) console.log('  ✅  全部文章页 SEO 元数据齐全');
  return issues;
}

/* ─────────── 检查 9: 站点基础设施 ─────────── */
function checkInfra() {
  printSection('站点基础设施');
  const issues = [];
  for (const name of ['robots.txt', '404.html', 'sitemap.xml', 'feed.xml']) {
    if (!fs.existsSync(path.join(ROOT, name))) issues.push(name + ' 缺失');
  }
  const robots = path.join(ROOT, 'robots.txt');
  if (fs.existsSync(robots) && !/^\s*Sitemap\s*:/im.test(fs.readFileSync(robots, 'utf8'))) {
    issues.push('robots.txt 未声明 Sitemap');
  }
  printRow('robots / 404 / sitemap / feed', issues.length === 0 ? '4/4 齐全' : issues.join('; '), issues.length === 0);
  for (const i of issues) printRow('基础设施', i, false);
  return issues;
}

/* ─────────── 主流程 ─────────── */

function main() {
  const args = process.argv.slice(2);
  const doFix = args.includes('--fix');

  console.log('─────────────────────────────────────────');
  console.log('  repo-lint · 仓库一致性检查');
  console.log(`  工作目录: ${ROOT}`);
  console.log('─────────────────────────────────────────');

  const { postCount, articles, displayNum, homeHtml } = checkPostCount();
  const deadLinks = checkDeadLinks(articles);
  const orphans = checkOrphanPosts(articles);
  const { dupIds, dupTitles } = checkDuplicates(articles);
  const heroStatus = checkIndexHero(postCount);
  const favStatus = checkFaviconConsistency();
  const missingReadCss = checkReadCss();
  const seoIssues = checkSeoMeta();
  const infraIssues = checkInfra();

  console.log('\n━━━━━ 总览 ━━━━━');
  const issueCount =
    deadLinks.length + orphans.length + dupIds.length + missingReadCss.length +
    seoIssues.length + infraIssues.length +
    (displayNum !== null && displayNum !== postCount ? 1 : 0) +
    (postCount !== articles.length ? 1 : 0) +
    (heroStatus && heroStatus.actual !== heroStatus.shouldBe ? 1 : 0) +
    (favStatus.usesOldPng > 0 ? 1 : 0);

  if (issueCount === 0) {
    console.log('  ✅  全部通过，仓库状态干净');
  } else {
    console.log(`  ⚠ 发现 ${issueCount} 项问题，建议处理后推送`);
  }
  console.log('');

  // ── 可选自动修复：更新 home.html 显示数字 + index.html hero 数字 ──
  if (doFix) {
    let fixed = false;
    // 修复 home.html "共 N 篇"
    if (displayNum !== null && displayNum !== postCount) {
      const newHome = homeHtml.replace(/共\s*\d+\s*篇/, `共 ${postCount} 篇`);
      fs.writeFileSync(path.join(ROOT, 'home/home.html'), newHome);
      console.log(`  🔧  已修复 home.html "共 N 篇"：${displayNum} → ${postCount}`);
      fixed = true;
    }
    // 修复 index.html hero 第一个 num
    const indexPath = path.join(ROOT, 'index.html');
    if (heroStatus && heroStatus.actual !== heroStatus.shouldBe && fs.existsSync(indexPath)) {
      const indexHtml = fs.readFileSync(indexPath, 'utf8');
      const newIndex = indexHtml.replace(
        /(<div class="hero-stats">[\s\S]*?<div class="num">)(\d+)(<\/div>)/,
        `$1${postCount}$3`,
      );
      fs.writeFileSync(indexPath, newIndex);
      console.log(`  🔧  已修复 index.html hero articles 数字：${heroStatus.actual} → ${postCount}`);
      fixed = true;
    }
    if (!fixed) console.log('  ℹ  --fix 无可自动修复的内容');
  } else if (issueCount > 0) {
    console.log('  💡 提示: 可加 --fix 自动修复显示数字（显示数字与物理文件数不符时）');
  }

  process.exit(issueCount === 0 ? 0 : 1);
}

main();
