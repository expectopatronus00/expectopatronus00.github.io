#!/usr/bin/env node
/**
 * douyin-post-skill / generate.js
 * -----------------------------------------
 * 批量生成抖音搬运文章 + 自动更新 home.html / index.html
 *
 * 用法:
 *   node skills/douyin-post-skill/generate.js path/to/videos.json
 *
 * 输入文件 (JSON):
 *   参见 skills/douyin-post-skill/batch-template.json
 *
 * 输出:
 *   - post/dy-{ID}/dy-{ID}.html     (N个文章页)
 *   - 自动更新 home/articles.js     (window.articles 数组)
 *   - 自动更新 home.html            (统计数字)
 *   - 自动更新 index.html           (hero 统计数字；latest-grid 由前端 JS 渲染)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const HOME_PATH = path.join(ROOT, 'home', 'home.html');
const INDEX_PATH = path.join(ROOT, 'index.html');
const ARTICLES_JS_PATH = path.join(ROOT, 'home', 'articles.js');

// ---------- 工具 ----------
function read(file) {
  return fs.readFileSync(file, 'utf8');
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  console.log('  写入: ' + file);
}

// ---------- 读取输入 ----------
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node generate.js <videos.json>');
  console.error('模板: skills/douyin-post-skill/batch-template.json');
  process.exit(1);
}
const inputPath = path.resolve(args[0]);
let videos;
try {
  videos = JSON.parse(read(inputPath));
} catch (e) {
  console.error('JSON 解析失败: ' + e.message);
  process.exit(1);
}
if (!Array.isArray(videos) || videos.length === 0) {
  console.error('videos.json 必须是非空数组');
  process.exit(1);
}

let template;
try {
  template = read(TEMPLATE_PATH);
} catch (e) {
  console.error('无法读取 template.html: ' + e.message);
  process.exit(1);
}
let homeHtml = read(HOME_PATH);
let indexHtml = read(INDEX_PATH);
let articlesJs = read(ARTICLES_JS_PATH);

console.log('=== 开始批量生成 ' + videos.length + ' 篇文章 ===');
console.log();

// ---------- 第 1 步: 生成文章 HTML ----------
const generated = [];

for (let i = 0; i < videos.length; i++) {
  const v = videos[i];
  const id = v.id;
  if (!id) {
    console.error('  跳过: 缺少 id');
    continue;
  }

  const contentLines = Array.isArray(v.content_html) ? v.content_html : [String(v.content_html || '')];
  let contentHtml = contentLines.join('\n');

  let platformsHtml = '';
  if (Array.isArray(v.platforms) && v.platforms.length > 0) {
    const items = [];
    for (let k = 0; k < v.platforms.length; k++) {
      const p = v.platforms[k];
      // p.icon 直接是内联 SVG 字符串（如 "<svg class='icon icon-sm' ...>...</svg>"），
      // 不再是 Font Awesome class 名
      const iconSvg = p.icon || '';
      items.push(
        '      <a class="plat-card" href="' + p.url + '" target="_blank" rel="noopener">\n' +
        '        ' + iconSvg + '\n' +
        '        <span class="pn">' + p.name + '</span>\n' +
        '        <span class="pd">' + (p.desc || '') + '</span>\n' +
        '      </a>'
      );
    }
    platformsHtml =
      '    <div class="platforms">\n' +
      '      <h2>相关平台</h2>\n' +
      '      <div class="platform-list">\n' +
      items.join('\n') + '\n' +
      '      </div>\n' +
      '    </div>';
  }

  let tagsHtml = '';
  if (Array.isArray(v.tags) && v.tags.length > 0) {
    const tagItems = [];
    for (let m = 0; m < v.tags.length; m++) {
      tagItems.push('      <a href="#">#' + v.tags[m] + '</a>');
    }
    tagsHtml =
      '    <div class="tags-row">\n' +
      tagItems.join('\n') + '\n' +
      '    </div>';
  }

  let ctaHtml = '';
  if (v.cta && v.cta.url) {
    const ARROW_SVG = '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 7h9v9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    ctaHtml =
      '    <div class="cta-box">\n' +
      '      <div class="content">\n' +
      '        <h3>' + (v.cta.title || '去抖音看原视频') + '</h3>\n' +
      '        <p>' + (v.cta.desc || '点击跳转抖音原视频页') + '</p>\n' +
      '      <a class="cta-btn" id="cta-link" href="' + v.cta.url + '" target="_blank" rel="noopener">\n' +
      '          ' + ARROW_SVG + ' 前往抖音\n' +
      '        </a>\n' +
      '      </div>\n' +
      '    </div>';
  }

  const footerMeta = v.footer_meta || '本站内容纯学习用途，非商用。视频封面版权归抖音原视频作者所有。';

  // 把 contentHtml + ctaHtml + platformsHtml + tagsHtml 合并到 CONTENT_HTML
  const fullContent = contentHtml +
    (ctaHtml ? '\n' + ctaHtml : '') +
    (platformsHtml ? '\n' + platformsHtml : '') +
    (tagsHtml ? '\n' + tagsHtml : '');

  const html = template
    .replaceAll('{{EYEBROW}}', v.eyebrow || v.title)
    .replaceAll('{{TITLE}}', v.title)
    .replaceAll('{{META_DESC}}', v.meta_desc || v.summary || '')
    .replaceAll('{{META_KEYWORDS}}', v.meta_keywords || (v.tags ? v.tags.join(', ') : ''))
    .replaceAll('{{OG_TITLE}}', v.title)
    .replaceAll('{{OG_DESC}}', v.meta_desc || v.summary || '')
    .replaceAll('{{AUTHOR}}', v.author || '佚名')
    .replaceAll('{{DATE_TODAY}}', v.date || new Date().toISOString().slice(0, 10))
    .replaceAll('{{DURATION}}', v.duration || '约 5 分钟阅读')
    .replaceAll('{{COVER_URL}}', v.cover || '')
    .replaceAll('{{SUMMARY_HTML}}', v.summary || '')
    .replace('{{CONTENT_HTML}}', fullContent) // CONTENT_HTML 只替换一次
    .replaceAll('{{FOOTER_META}}', footerMeta);

  const dir = path.join(ROOT, 'post', id);
  const outPath = path.join(dir, id + '.html');
  write(outPath, html);
  generated.push(v);
}

if (generated.length === 0) {
  console.error('没有生成任何文章，退出。');
  process.exit(1);
}

console.log();
console.log('--- 已生成 ' + generated.length + ' 篇文章 ---');

// ---------- 第 2 步: 更新 home.html ----------
console.log();
console.log('--- 更新 home.html ---');

// 更新 A: "共 N 篇"
const homeCountMatch = homeHtml.match(/共 (\d+) 篇/);
const homeOldCount = homeCountMatch ? parseInt(homeCountMatch[1], 10) : 0;
const homeNewCount = homeOldCount + generated.length;
homeHtml = homeHtml.replace(/共 \d+ 篇/, '共 ' + homeNewCount + ' 篇');
console.log('  统计: ' + homeOldCount + ' → ' + homeNewCount);

// 更新 B: 在 home/articles.js 的 window.articles 数组最前面插入新条目
const articlesAnchor = 'window.articles = [';
const idx = articlesJs.indexOf(articlesAnchor);
if (idx === -1) {
  console.error('  警告: 找不到 "window.articles = ["，跳过 articles.js 更新');
} else {
  const insertPos = idx + articlesAnchor.length;
  const objects = [];
  for (let j = 0; j < generated.length; j++) {
    const g = generated[j];
    const tagStr = Array.isArray(g.tags) ? '["' + g.tags.join('","') + '"]' : '[]';
    objects.push(
      '\n          {\n' +
      '            id: \'' + g.id + '\',\n' +
      '            title: \'' + String(g.title).replace(/'/g, "\\'") + '\',\n' +
      '            url: \'../post/' + g.id + '/' + g.id + '.html\',\n' +
      '            summary: \'' + String(g.summary || '').replace(/'/g, "\\'") + '\',\n' +
      '            category: \'抖音搬运\',\n' +
      '            date: \'' + g.date + '\',\n' +
      '            tags: ' + tagStr + ',\n' +
      '          },'
    );
  }
  articlesJs = articlesJs.slice(0, insertPos) + objects.join('') + articlesJs.slice(insertPos);
  console.log('  articles.js: 已追加 ' + generated.length + ' 项');
}
write(ARTICLES_JS_PATH, articlesJs);
write(HOME_PATH, homeHtml);

// ---------- 第 3 步: 更新 index.html ----------
console.log();
console.log('--- 更新 index.html ---');

// 更新 A: 第一个 class="num" 内的数字（文章总数）
let indexOldCount = homeOldCount;
let indexNewCount = indexOldCount + generated.length;
indexHtml = indexHtml.replace(/<div class="num">(\d+)<\/div>/, function (match, n) {
  indexOldCount = parseInt(n, 10);
  indexNewCount = indexOldCount + generated.length;
  return '<div class="num">' + indexNewCount + '</div>';
});
console.log('  统计: ' + indexOldCount + ' → ' + indexNewCount);
write(INDEX_PATH, indexHtml);

// ---------- 完成 ----------
console.log();
console.log('=== 完成 ===');
console.log();
console.log('已生成文章页:');
for (let i = 0; i < generated.length; i++) {
  console.log('  - post/' + generated[i].id + '/' + generated[i].id + '.html');
}
console.log();
console.log('已更新:');
console.log('  - home/articles.js  (window.articles 数组已追加 ' + generated.length + ' 项)');
console.log('  - home/home.html    (共 ' + homeNewCount + ' 篇)');
console.log('  - index.html        (hero 数: ' + indexNewCount + ', latest-grid 由前端 JS 动态渲染)');
console.log();
console.log('建议执行:');
console.log('  cd /workspace');
console.log('  git add -A');
console.log('  git commit -m "feat: 新增' + generated.length + '篇抖音搬运文章"');
console.log('  git push origin HEAD:main');
console.log();

// ---------- 第 4 步: 自动调用 repo-lint 自检 ----------
const LINT_PATH = path.join(ROOT, 'scripts', 'repo-lint.cjs');
console.log('=== 自动运行仓库一致性检查 ===');
try {
  const result = execFileSync('node', [LINT_PATH, '--fix'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log(result);
  console.log('✅ 检查通过，已自动修复显示数字');
} catch (err) {
  if (err.stdout) console.log(err.stdout);
  if (err.stderr) console.error(err.stderr);
  console.log('⚠️  检查发现问题，请根据上方输出手工修复');
  process.exitCode = 1;
}
