#!/usr/bin/env node
/**
 * site-health.cjs · 站点健康检查（确定性，可在本地或 CI 跑）
 * -----------------------------------------
 * 只回答一个问题：站点是不是好的。不参与选题、不生成内容。
 *
 * 用法：
 *   node scripts/site-health.cjs                  # 检查并通知
 *   node scripts/site-health.cjs --dry-run        # 只打印，不通知
 *   node scripts/site-health.cjs --stale-days 10  # 断更阈值，默认 7 天
 *   node scripts/site-health.cjs --offline        # 跳过线上探活，只查本地
 *
 * 检查项：
 *   1. feed.xml 条目数是否跟得上文章总数（新增文章没重建索引会被抓出来）
 *   2. 线上首页 / feed.xml / 最新一篇文章页 是否 200
 *   3. 线上 feed 是否与本地一致（部署有没有生效）
 *   4. 距离上一篇文章是否超过阈值（断更告警）
 *
 * 退出码：0 全部通过，1 有失败项
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { notify } = require('./notify.cjs');

const ROOT = path.resolve(__dirname, '..');
const FEED = path.join(ROOT, 'feed.xml');
const POST_DIR = path.join(ROOT, 'post');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const OFFLINE = argv.includes('--offline');
const argVal = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

const SITE = (argVal('--site') || process.env.SITE_URL || 'https://expectopatronus00.github.io').replace(
  /\/+$/,
  ''
);
const STALE_DAYS = Number(argVal('--stale-days') || process.env.STALE_DAYS || 7);
const FEED_LIMIT = 30; // build-index.cjs 里 feed 只放最近 30 篇

/* ─────────── 工具 ─────────── */

function fetchUrl(url, depth) {
  const d = depth || 0;
  return new Promise(resolve => {
    if (d > 5) return resolve({ ok: false, error: '重定向次数过多' });
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return resolve({ ok: false, error: 'URL 无效' });
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(
      u,
      {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; blog-health/1.0)',
          'Cache-Control': 'no-cache',
        },
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).toString();
          return fetchUrl(next, d + 1).then(resolve);
        }
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () =>
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body })
        );
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: '超时' });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
  });
}

function parseFeed(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const t = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>'));
      return t ? t[1].trim() : '';
    };
    items.push({ title: get('title'), link: get('link'), pubDate: get('pubDate') });
  }
  return items;
}

function countPosts() {
  try {
    return fs.readdirSync(POST_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).length;
  } catch (e) {
    return 0;
  }
}

function daysSince(dateStr) {
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* ─────────── 主流程 ─────────── */

async function main() {
  const checks = [];
  const fail = (name, detail) => checks.push({ name, ok: false, detail });
  const pass = (name, detail) => checks.push({ name, ok: true, detail: detail || '' });

  if (!fs.existsSync(FEED)) {
    fail('feed.xml 存在', '文件不存在');
  } else {
    const localXml = fs.readFileSync(FEED, 'utf8');
    const items = parseFeed(localXml);
    const posts = countPosts();
    const expected = Math.min(posts, FEED_LIMIT);

    if (items.length + 2 < expected) {
      fail('feed 条目数', `只有 ${items.length} 条，按 ${posts} 篇文章应有 ${expected} 条`);
    } else {
      pass('feed 条目数', `${items.length} 条 / 文章 ${posts} 篇`);
    }

    const newest = items[0];
    if (!newest) {
      fail('feed 内容', '没有任何条目');
    } else {
      const days = daysSince(newest.pubDate);
      if (days !== null && days > STALE_DAYS) {
        fail('更新节奏', `已 ${days} 天没有新文章（阈值 ${STALE_DAYS} 天）`);
      } else {
        pass('更新节奏', `${days} 天前更新：${newest.title.slice(0, 30)}`);
      }

      if (OFFLINE) {
        console.log('ℹ --offline，跳过线上探活');
      } else {
        const home = await fetchUrl(SITE + '/');
        if (!home.ok) fail('线上首页', home.error || home.status);
        else pass('线上首页', '200');

        const remoteFeed = await fetchUrl(SITE + '/feed.xml');
        if (!remoteFeed.ok) {
          fail('线上 feed.xml', remoteFeed.error || remoteFeed.status);
        } else {
          const remoteItems = parseFeed(remoteFeed.body);
          if (remoteItems.length !== items.length) {
            fail('线上 feed 已同步', `线上 ${remoteItems.length} 条，本地 ${items.length} 条`);
          } else if (remoteItems[0] && remoteItems[0].link !== items[0].link) {
            fail('线上 feed 已同步', '最新一篇不一致，部署可能未生效');
          } else {
            pass('线上 feed 已同步', `${remoteItems.length} 条`);
          }
        }

        if (newest.link) {
          const page = await fetchUrl(newest.link);
          if (!page.ok) fail('最新文章页', (page.error || page.status) + ' ' + newest.link);
          else pass('最新文章页', '200');
        }
      }
    }
  }

  // 汇总
  const failed = checks.filter(c => !c.ok);
  console.log('─────────────────────────────────────────');
  console.log('  site-health · ' + SITE);
  console.log('─────────────────────────────────────────');
  for (const c of checks) {
    console.log((c.ok ? '✅ ' : '❌ ') + c.name + (c.detail ? ' — ' + c.detail : ''));
  }
  console.log('');

  const title = failed.length ? `站点异常 · ${failed.length} 项` : '站点健康';
  const body = checks.map(c => (c.ok ? '✅ ' : '❌ ') + c.name + (c.detail ? '：' + c.detail : '')).join('\n');

  if (DRY_RUN) {
    console.log('(dry-run 未发送通知)');
  } else {
    await notify({ title, body });
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch(e => {
  console.error('site-health 异常:', e && e.message);
  process.exit(1);
});
