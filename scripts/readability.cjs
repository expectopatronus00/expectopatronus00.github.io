#!/usr/bin/env node
/**
 * scripts/readability.cjs · 文章易读性体检
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要它：这个站的文章是「GitHub 数据密集型技术长文」，最容易出现的
 * 问题不是错字，是一段里塞 400 字、8 个数字、10 个 <code>，读者扫不动。
 * 光靠写作规范管不住模型，得有一个可执行的分数卡在成稿环节。
 *
 * 只量「结构」，不量「文采」：段落长度、结构化块、高亮/代码密度、核对框长度。
 * 存量 144 篇是历史稿，分数低属正常，本脚本默认不因此让流水线失败；
 * 只有对新稿（--file / --today）才按阈值把关。
 *
 * 用法：
 *   node scripts/readability.cjs --file post/<id>/<id>.html   # 单篇（≥75 才过）
 *   node scripts/readability.cjs --today                      # 今天新增的稿子
 *   node scripts/readability.cjs --all                        # 全站基线（只报告）
 *   node scripts/readability.cjs --all --json                 # 机器可读
 *   --warn-only          # 永远返回 0（供 daily-run 汇报用）
 *   --strict             # --all 也按阈值判失败
 *
 * 退出码：0 通过 / 报告；1 有稿件低于 60 分（--warn-only 时恒为 0）
 *
 * 分数口径见 score()，可作为模块 require：
 *   const { analyzeHtml, analyzeFile, collectToday } = require('./readability.cjs');
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRAFTS = path.join(ROOT, '.tools', 'radar', 'drafts.json');

const LIMIT = {
  paraSoft: 140,   // 建议段落上限
  paraHard: 180,   // 超过即扣分
  hlPer1000: 6,    // 每千字高亮上限
  codePer1000: 12, // 每千字行内代码上限
  infoBox: 400,    // 核对框建议上限
  pass: 75,
  rewrite: 60,
};

/* ─────────── 解析 ─────────── */

function extractBody(html) {
  let m = html.match(/<article\b[^>]*class=["'][^"']*article-body[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  if (!m) m = html.match(/<div\b[^>]*class=["'][^"']*article-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  let body = m ? m[1] : '';
  if (!body) return '';
  // CTA / 相关平台 / 标签不算正文
  const cut = body.search(/<div\s+class=["'](?:cta-box|platforms|tags-row|source-note|merged-note)/i);
  if (cut > 0) body = body.slice(0, cut);
  return body;
}

function plain(fragment) {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chars(fragment) {
  return plain(fragment).replace(/\s/g, '').length;
}

function all(re, s) {
  const out = [];
  let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(s)) !== null) out.push(m);
  return out;
}

/* ─────────── 打分 ─────────── */

function analyzeHtml(html, label) {
  const body = extractBody(html);
  const base = { label: label || '', score: 0, verdict: '', suggestions: [], error: '' };
  if (!body) {
    return Object.assign(base, { error: '找不到 .article-body 正文区' });
  }

  const paras = all(/<p\b[^>]*>([\s\S]*?)<\/p>/i, body).map(m => m[1]);
  const lens = paras.map(chars).filter(n => n > 0);
  const totalChars = lens.reduce((a, b) => a + b, 0) || 1;

  const sections = all(/class=["'][^"']*section-marker/i, body).length || all(/<h2\b/i, body).length;
  const lists = all(/<(?:ul|ol)\b/i, body).length;
  const tables = all(/<table\b/i, body).length;
  const leads = all(/<p\b[^>]*>\s*<strong>/i, body).length;
  const hl = all(/class=["'][^"']*\bhl\b/i, body).length;
  const code = all(/<code\b/i, body).length;
  const infoBoxes = all(/<div\s+class=["']info-box[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, body).map(m => chars(m[1]));

  const longParas = lens.filter(n => n > LIMIT.paraHard).length;
  const softParas = lens.filter(n => n > LIMIT.paraSoft).length;
  const maxPara = lens.length ? Math.max.apply(null, lens) : 0;
  const avgPara = lens.length ? Math.round(totalChars / lens.length) : 0;
  const longRatio = lens.length ? longParas / lens.length : 0;
  const hlDensity = (hl * 1000) / totalChars;
  const codeDensity = (code * 1000) / totalChars;
  const maxInfo = infoBoxes.length ? Math.max.apply(null, infoBoxes) : 0;

  /* 100 分起扣。每条扣分都对应一条可执行的改写建议。 */
  let score = 100;
  const cuts = [];
  function cut(points, msg) {
    score -= points;
    cuts.push({ points, msg });
  }

  if (longParas > 0) {
    cut(Math.min(26, Math.round(longRatio * 55) + 4), `有 ${longParas} 段超过 ${LIMIT.paraHard} 字（占 ${Math.round(longRatio * 100)}%），拆成两段或改写成 <ul> 列表`);
  }
  if (maxPara > 300) cut(8, `最长段 ${maxPara} 字，读者会失去行位置；在第一个句号处断开`);
  else if (maxPara > 220) cut(4, `最长段 ${maxPara} 字，建议压到 ${LIMIT.paraSoft} 字以内`);
  if (avgPara > 150) cut(10, `平均段长 ${avgPara} 字，整篇都是文字墙`);
  else if (avgPara > 120) cut(5, `平均段长 ${avgPara} 字，偏长`);
  else if (avgPara > 100) cut(2, `平均段长 ${avgPara} 字，略长`);

  if (lists === 0 && tables === 0) cut(12, '全文没有任何列表或表格，密集数据请用 <ul> / <table> 拆开');
  else if (sections >= 3 && (lists + tables) < Math.ceil(sections / 2)) {
    cut(6, `${sections} 节只有 ${lists + tables} 个结构化块，每节至少给一个`);
  }

  if (hlDensity > LIMIT.hlPer1000 * 1.5) cut(8, `高亮 ${hl} 处（每千字 ${hlDensity.toFixed(1)} 处），重点被稀释`);
  else if (hlDensity > LIMIT.hlPer1000) cut(4, `高亮 ${hl} 处偏多，全文控制在 8 处以内`);

  if (codeDensity > LIMIT.codePer1000) cut(6, `行内代码 ${code} 处（每千字 ${codeDensity.toFixed(1)} 处），一句话里别塞超过 2 个 <code>`);

  if (maxInfo > LIMIT.infoBox * 2) cut(6, `数据核对框 ${maxInfo} 字，改成分条 <ul>；页面会自动折叠，但内容仍要拆`);
  else if (maxInfo > LIMIT.infoBox) cut(3, `数据核对框 ${maxInfo} 字，超过 ${LIMIT.infoBox} 字建议分条`);

  if (sections < 3) cut(6, `只有 ${sections} 节，缺少 01→05 的扫读锚点`);
  if (sections >= 3 && leads < 2) cut(3, '几乎每节都没有加粗判断句，扫读时抓不住结论');

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score >= LIMIT.pass ? '通过' : score >= LIMIT.rewrite ? '建议改写' : '不通过';

  return Object.assign(base, {
    score,
    verdict,
    totalChars,
    sections,
    paras: lens.length,
    avgPara,
    maxPara,
    longParas,
    softParas,
    lists,
    tables,
    leads,
    hl,
    hlDensity: Number(hlDensity.toFixed(1)),
    code,
    codeDensity: Number(codeDensity.toFixed(1)),
    infoBoxes: infoBoxes.length,
    maxInfo,
    cuts,
    suggestions: cuts.map(c => c.msg),
  });
}

function analyzeFile(file) {
  const label = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!fs.existsSync(file)) return { label, score: 0, verdict: '不通过', suggestions: [], error: '文件不存在' };
  return analyzeHtml(fs.readFileSync(file, 'utf8'), label);
}

/** 从 .tools/radar/drafts.json 取今天写过的稿子 */
function collectToday(dateStr) {
  const day = dateStr || new Date().toISOString().slice(0, 10);
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(DRAFTS, 'utf8'));
  } catch (e) {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(d => d && d.date === day && d.id)
    .map(d => analyzeFile(path.join(ROOT, 'post', d.id, d.id + '.html')))
    .filter(r => !r.error);
}

function listAll() {
  const out = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.html')) out.push(analyzeFile(p));
    }
  }
  walk(path.join(ROOT, 'post'));
  return out.filter(r => !r.error);
}

/* ─────────── 输出 ─────────── */

function printOne(r) {
  console.log('─────────────────────────────────────────');
  console.log('  易读性体检 · ' + r.label);
  console.log('─────────────────────────────────────────');
  if (r.error) {
    console.log('  ✖ ' + r.error);
    return;
  }
  console.log(`  得分   ${r.score} / 100   ${r.verdict}`);
  console.log(`  正文   ${r.totalChars} 字 · ${r.sections} 节 · ${r.paras} 段`);
  console.log(`  段落   平均 ${r.avgPara} 字 / 最长 ${r.maxPara} 字 / 超 ${LIMIT.paraHard} 字 ${r.longParas} 段`);
  console.log(`  结构   列表 ${r.lists} · 表格 ${r.tables} · 加粗引导 ${r.leads} · 高亮 ${r.hl} · 代码 ${r.code}`);
  console.log(`  核对框 ${r.infoBoxes} 个 · 最长 ${r.maxInfo} 字`);
  if (r.suggestions.length) {
    console.log('  建议');
    for (const s of r.suggestions) console.log('    - ' + s);
  } else {
    console.log('  建议   无，结构达标');
  }
  console.log('');
}

function printTable(rows) {
  console.log('  得分  段落均长  最长段  超长段  列表/表格  核对框  文件');
  console.log('  ────  ────────  ──────  ──────  ─────────  ──────  ────');
  for (const r of rows) {
    console.log(
      '  ' + String(r.score).padStart(3) + '  ' +
      String(r.avgPara).padStart(8) + '  ' +
      String(r.maxPara).padStart(6) + '  ' +
      String(r.longParas).padStart(6) + '  ' +
      (r.lists + '/' + r.tables).padStart(9) + '  ' +
      String(r.maxInfo).padStart(6) + '  ' +
      r.label
    );
  }
  const avg = rows.length ? Math.round(rows.reduce((a, b) => a + b.score, 0) / rows.length) : 0;
  const pass = rows.filter(r => r.score >= LIMIT.pass).length;
  console.log('');
  console.log(`  ${rows.length} 篇 · 平均 ${avg} 分 · 达标(≥${LIMIT.pass}) ${pass} 篇 · 最低 ${rows.length ? Math.min.apply(null, rows.map(r => r.score)) : 0} 分`);
}

/* ─────────── CLI ─────────── */

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const warnOnly = argv.includes('--warn-only');
  const strict = argv.includes('--strict');
  const iFile = argv.indexOf('--file');

  let rows;
  let single = false;
  if (iFile >= 0 && argv[iFile + 1]) {
    rows = [analyzeFile(path.resolve(ROOT, argv[iFile + 1]))];
    single = true;
  } else if (argv.includes('--today')) {
    rows = collectToday();
  } else {
    rows = listAll();
  }

  if (json) {
    console.log(JSON.stringify(single ? rows[0] : rows, null, 2));
  } else if (single) {
    printOne(rows[0]);
  } else {
    console.log('─────────────────────────────────────────');
    console.log('  readability · 易读性体检' + (argv.includes('--today') ? ' · 今日新增' : ' · 全站基线'));
    console.log('─────────────────────────────────────────');
    if (!rows.length) console.log('  今日无新增文章，跳过体检。');
    else printTable(rows.sort((a, b) => a.score - b.score));
    console.log('');
  }

  if (warnOnly) process.exit(0);
  const blocking = rows.filter(r => r.error || r.score < LIMIT.rewrite);
  if (blocking.length && (single || argv.includes('--today') || strict)) process.exit(1);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { analyzeHtml, analyzeFile, collectToday, listAll, LIMIT };
