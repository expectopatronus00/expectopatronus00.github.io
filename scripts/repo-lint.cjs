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

  console.log('\n━━━━━ 总览 ━━━━━');
  const issueCount =
    deadLinks.length + orphans.length + dupIds.length +
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
