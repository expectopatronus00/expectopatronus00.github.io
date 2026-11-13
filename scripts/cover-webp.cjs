#!/usr/bin/env node
/**
 * 封面 webp 伴生图 —— 唯一实现。
 *
 *   node scripts/cover-webp.cjs            为缺/过期的 cover.jpg 生成 cover.webp
 *   node scripts/cover-webp.cjs --check   只检查，不写盘
 *
 * 用 Chromium 的 canvas.toDataURL('image/webp') 编码，项目里没有 sharp / cwebp / PIL，
 * 也不需要往仓库里装依赖。cover.jpg 一律保留：og:image 与 <picture> 的 fallback 都要它，
 * 部分社交平台对 webp 缩略图兼容不佳。
 *
 * build-article.cjs 复用 encodeWebp()，在生成新封面的同时产出 webp。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POST = path.join(ROOT, 'post');

/** 把一个 jpeg/png buffer 在浏览器里编码成 webp。page 由调用方提供，本模块不加载 playwright。 */
async function encodeWebp(page, inputBuffer, mime = 'image/jpeg', quality = 0.82) {
  const dataUrl = 'data:' + mime + ';base64,' + inputBuffer.toString('base64');
  const url = await page.evaluate(async (arg) => {
    const img = new Image();
    img.src = arg.url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', arg.q);
  }, { url: dataUrl, q: quality });
  if (!url.startsWith('data:image/webp')) throw new Error('当前浏览器不支持 webp 编码');
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

function walkCovers(dir = POST, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkCovers(p, out);
    else if (e.name === 'cover.jpg') out.push(p);
  }
  return out;
}

function pendingList() {
  return walkCovers().filter((jpg) => {
    const webp = jpg.replace(/\.jpg$/, '.webp');
    return !fs.existsSync(webp) || fs.statSync(webp).mtimeMs < fs.statSync(jpg).mtimeMs;
  });
}

async function scanAndConvert(opts = {}) {
  const all = walkCovers();
  const pending = pendingList();
  if (opts.check || !pending.length) {
    return { total: all.length, pending: pending.length, converted: 0, savedBytes: 0 };
  }

  /* 只有真要转的时候才加载 playwright（项目依赖里没有，靠 NODE_PATH 指向隔离工作区） */
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  let converted = 0, savedBytes = 0;
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    for (const jpg of pending) {
      const jpgBuf = fs.readFileSync(jpg);
      const webpBuf = await encodeWebp(page, jpgBuf, 'image/jpeg');
      fs.writeFileSync(jpg.replace(/\.jpg$/, '.webp'), webpBuf);
      converted++;
      savedBytes += jpgBuf.length - webpBuf.length;
      console.log(
        '  + ' + path.relative(ROOT, jpg).replace(/\\/g, '/').replace(/cover\.jpg$/, 'cover.webp') +
        ' · ' + (jpgBuf.length / 1024).toFixed(0) + ' → ' + (webpBuf.length / 1024).toFixed(0) + ' KB'
      );
    }
  } finally {
    await browser.close();
  }
  return { total: all.length, pending: pending.length, converted, savedBytes };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  scanAndConvert({ check })
    .then((r) => {
      if (check) {
        console.log('封面 ' + r.total + ' 张 · 缺/过期 webp ' + r.pending + ' 张');
        console.log(r.pending ? '✗ 需运行 node scripts/cover-webp.cjs' : '✓ 全部封面已有最新 webp');
        if (r.pending) process.exit(1);
      } else {
        console.log('✅ 转换 ' + r.converted + ' 张，净省 ' + (r.savedBytes / 1024 / 1024).toFixed(2) + ' MB（共 ' + r.total + ' 张封面）');
      }
    })
    .catch((e) => {
      console.error('封面 webp 转换失败：' + e.message);
      console.error('需要 NODE_PATH 指向含 playwright 的隔离工作区，例如：');
      console.error('  NODE_PATH=C:/Users/Administrator/.workbuddy-ai/binaries/node/workspace/node_modules node scripts/cover-webp.cjs');
      process.exit(1);
    });
}

module.exports = { ROOT, encodeWebp, walkCovers, pendingList, scanAndConvert };
