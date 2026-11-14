#!/usr/bin/env node
/**
 * scripts/apply-skip-link.cjs · 幂等批量补齐全站 skip-link
 * ---------------------------------------------------------------------------
 * 唯一实现在 scripts/skip-link.cjs；本文件只负责遍历、落盘、CLI。
 *
 *   node scripts/apply-skip-link.cjs           执行注入
 *   node scripts/apply-skip-link.cjs --dry     预览（不落盘）
 *   node scripts/apply-skip-link.cjs --check  有缺口时退出码 1
 *   node scripts/apply-skip-link.cjs --show <路径>  打印某页的注入块
 *   node scripts/apply-skip-link.cjs --revert 去掉注入内容
 *
 * build-index.cjs 在收尾链路里自动调用，新页不会漏。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { walkPages } = require('./head-hints.cjs');
const {
  stripSkip, injectSkip, readSkip, anchorTag,
} = require('./skip-link.cjs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const check = args.includes('--check');
const revert = args.includes('--revert');
const showIdx = args.indexOf('--show');

function rel(f) {
  return path.relative(ROOT, f).replace(/\\/g, '/');
}

function processPage(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = revert ? stripSkip(before) : injectSkip(before);
  return { before, after, changed: after !== before, hasBlock: !!readSkip(after) };
}

function run() {
  const files = walkPages(ROOT);

  if (showIdx >= 0) {
    const target = args[showIdx + 1];
    if (!target) { console.error('用法：--show <html 路径>'); process.exit(1); }
    const file = path.resolve(ROOT, target);
    const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    console.log(html ? (readSkip(html) || '(该页没有 skip-link 块)') : '文件不存在：' + target);
    return;
  }

  let changed = 0, coverage = 0;
  const failed = [], samples = [];
  for (const file of files) {
    const r = processPage(file);
    if (!revert) {
      if (!anchorTag(stripSkip(r.before))) failed.push(rel(file) + '（找不到主内容锚点）');
      else if (r.hasBlock) coverage++;
    }
    if (!r.changed) continue;
    changed++;
    if (samples.length < 5) samples.push(rel(file));
    if (!dry && !check) fs.writeFileSync(file, r.after, 'utf8');
  }

  const label = revert ? '需清理' : '需更新';
  console.log('skip-link · 扫描 ' + files.length + ' 个页面');
  console.log('  ' + label + ' ' + changed + ' 个' +
    (dry ? '（预览，未落盘）' : check ? '（仅检查）' : ' · 已写入 ' + changed + ' 个'));
  if (changed && samples.length) console.log('  样例：' + samples.join('、'));
  if (!revert) console.log('  注入后覆盖率 ' + coverage + '/' + files.length);
  for (const f of failed.slice(0, 10)) console.log('  ! 无法注入：' + f);
  if (failed.length > 10) console.log('  … 另有 ' + (failed.length - 10) + ' 个');
  if (!changed && !failed.length && !revert) console.log('  ✅  全部页面已就位');
  if ((check && changed) || failed.length) process.exit(1);
}

if (require.main === module) run();

module.exports = { run, processPage };
