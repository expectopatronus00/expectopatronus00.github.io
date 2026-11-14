/**
 * apply-head-hints.cjs · 幂等批量注入全站 head 提示层
 * ---------------------------------------------------------------------------
 * 唯一实现在 scripts/head-hints.cjs；本文件只负责遍历、落盘、CLI。
 *
 *   node scripts/apply-head-hints.cjs              执行注入
 *   node scripts/apply-head-hints.cjs --dry        预览（不落盘）
 *   node scripts/apply-head-hints.cjs --check      只检查，需更新则退出码 1
 *   node scripts/apply-head-hints.cjs --show <路径> 打印某页的 hints 块
 *   node scripts/apply-head-hints.cjs --revert     去掉全部 hints 块
 *
 * build-index.cjs 会在重建索引后自动调用本脚本，所以每日收尾链路
 * 和 build-article.cjs 新稿产出都不会出现「漏注入」的窗口。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
  BEGIN, THEME_SCRIPT, cssBg, walkPages, stripHints, readHints, injectHints,
} = require('./head-hints.cjs');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const check = args.includes('--check');
const revert = args.includes('--revert');
const showIdx = args.indexOf('--show');

function processPage(file, darkBg) {
  const before = fs.readFileSync(file, 'utf8');
  const after = revert ? stripHints(before) : injectHints(before, darkBg);
  return { before, after, changed: after !== before };
}

function run() {
  const { dark, cssFound } = cssBg(ROOT);
  if (!cssFound) {
    console.error('✗ 未能从 home/design-tokens.css 解析 --ink-950 / --paper，拒绝注入');
    process.exit(1);
  }

  const files = walkPages(ROOT);

  if (showIdx >= 0) {
    const target = args[showIdx + 1];
    if (!target) {
      console.error('用法：--show <html 路径>');
      process.exit(1);
    }
    const file = path.resolve(ROOT, target);
    const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    console.log(html ? (readHints(html) || '(该页没有 hints 块)') : '文件不存在：' + target);
    return;
  }

  let changed = 0;
  const samples = [];
  for (const file of files) {
    const r = processPage(file, dark);
    if (!r.changed) continue;
    changed++;
    if (samples.length < 5) samples.push(path.relative(ROOT, file).replace(/\\/g, '/'));
    if (!dry && !check) fs.writeFileSync(file, r.after, 'utf8');
  }

  const label = revert ? '需清理' : '需更新';
  console.log('head-hints · 扫描 ' + files.length + ' 个页面 · 主题底色 ' + dark);
  console.log('  ' + label + ' ' + changed + ' 个' + (dry ? '（预览，未落盘）' : check ? '（仅检查）' : ' · 已写入 ' + changed + ' 个'));
  if (changed && samples.length) console.log('  样例：' + samples.join('、'));
  if (!changed) console.log('  ✅  全部页面已就位（' + THEME_SCRIPT + ' / preconnect / theme-color）');
  if (check && changed) process.exit(1);
}

if (require.main === module) run();

module.exports = { run, processPage, BEGIN };
