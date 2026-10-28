#!/usr/bin/env node
/**
 * notify.cjs · 统一通知出口
 * -----------------------------------------
 * 所有自动化环节都只调这一个文件。换渠道改这里，别在业务脚本里各写一份。
 *
 * 用法：
 *   node scripts/notify.cjs --title "日报" --body "正文"
 *   echo "正文" | node scripts/notify.cjs --title "日报"
 *   node scripts/notify.cjs --title "测试" --body "内容" --dry-run
 *
 * 渠道（全部可选，配了哪个走哪个，一个都没配就只打印到终端）：
 *   TG_BOT_TOKEN + TG_CHAT_ID      Telegram Bot
 *   BARK_URL                       Bark（https://api.day.app/你的key）
 *   SERVERCHAN_KEY                 Server 酱（微信推送）
 *   FEISHU_WEBHOOK                 飞书自定义机器人
 *   WECOM_WEBHOOK                  企业微信群机器人
 *   DINGTALK_WEBHOOK               钉钉自定义机器人
 *   NOTIFY_WEBHOOK                 通用 JSON POST（{ text }）
 *
 * 配置写在仓库根目录 .env（已 gitignore），也支持直接给环境变量。
 * 无第三方依赖，只用 node 内置模块。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

/* ─────────── .env 读取 ─────────── */

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const key = s.slice(0, i).trim();
    let val = s.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val; // 真实环境变量优先
  }
}

/* ─────────── HTTP ─────────── */

function request(url, options) {
  const opts = options || {};
  const method = opts.method || 'POST';
  return new Promise(resolve => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return resolve({ ok: false, error: 'URL 无效: ' + url });
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      u,
      { method, headers: opts.headers || {}, timeout: 15000 },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: d.slice(0, 200),
          })
        );
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: '请求超时' });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function postJson(url, obj) {
  const body = JSON.stringify(obj);
  return request(url, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
}

function postForm(url, obj) {
  const body = new URLSearchParams(obj).toString();
  return request(url, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
}

function clip(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* ─────────── 渠道 ─────────── */

function buildChannels() {
  const env = process.env;
  const list = [];

  if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
    list.push({
      name: 'Telegram',
      send: (title, body) =>
        postJson(
          'https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/sendMessage',
          {
            chat_id: env.TG_CHAT_ID,
            text: clip([title, body].filter(Boolean).join('\n\n'), 3800),
            disable_web_page_preview: true,
          }
        ),
    });
  }

  if (env.BARK_URL) {
    const base = env.BARK_URL.replace(/\/+$/, '');
    list.push({
      name: 'Bark',
      send: (title, body) =>
        request(
          base +
            '/' +
            encodeURIComponent(clip(title, 60)) +
            '/' +
            encodeURIComponent(clip(body, 900)),
          { method: 'GET' }
        ),
    });
  }

  if (env.SERVERCHAN_KEY) {
    list.push({
      name: 'Server酱',
      send: (title, body) =>
        postForm('https://sctapi.ftqq.com/' + env.SERVERCHAN_KEY + '.send', {
          title: clip(title, 32),
          desp: body || '',
        }),
    });
  }

  if (env.FEISHU_WEBHOOK) {
    list.push({
      name: '飞书',
      send: (title, body) =>
        postJson(env.FEISHU_WEBHOOK, {
          msg_type: 'text',
          content: { text: clip([title, body].filter(Boolean).join('\n\n'), 1500) },
        }),
    });
  }

  if (env.WECOM_WEBHOOK) {
    list.push({
      name: '企业微信',
      send: (title, body) =>
        postJson(env.WECOM_WEBHOOK, {
          msgtype: 'text',
          text: { content: clip([title, body].filter(Boolean).join('\n\n'), 1500) },
        }),
    });
  }

  if (env.DINGTALK_WEBHOOK) {
    list.push({
      name: '钉钉',
      send: (title, body) =>
        postJson(env.DINGTALK_WEBHOOK, {
          msgtype: 'text',
          text: { content: clip([title, body].filter(Boolean).join('\n\n'), 1500) },
        }),
    });
  }

  if (env.NOTIFY_WEBHOOK) {
    list.push({
      name: '通用 webhook',
      send: (title, body) =>
        postJson(env.NOTIFY_WEBHOOK, {
          text: clip([title, body].filter(Boolean).join('\n\n'), 1500),
        }),
    });
  }

  return list;
}

/* ─────────── 主函数 ─────────── */

async function notify(input) {
  const opts = input || {};
  loadEnv();

  const title = opts.title || '博客通知';
  const body = opts.body || '';
  const list = buildChannels();
  const text = [title, body].filter(Boolean).join('\n\n');

  if (opts.dryRun) {
    console.log('── dry-run ──');
    console.log('渠道:', list.length ? list.map(c => c.name).join(' / ') : '(未配置)');
    console.log('──');
    console.log(text);
    return { sent: 0, failed: 0, dryRun: true };
  }

  if (!list.length) {
    console.log('ℹ 未配置通知渠道，仅输出到终端（配置方式见 .env.example）');
    console.log('──');
    console.log(text);
    return { sent: 0, failed: 0, skipped: true };
  }

  let sent = 0;
  let failed = 0;
  for (const ch of list) {
    let r;
    try {
      r = await ch.send(title, body);
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    if (r && r.ok) {
      sent++;
      console.log('✅ 已推送 ' + ch.name);
    } else {
      failed++;
      console.log(
        '⚠️ 推送失败 ' + ch.name + '：' +
          (r && (r.error || r.status)) + (r && r.body ? ' ' + r.body : '')
      );
    }
  }
  return { sent, failed };
}

/* ─────────── CLI ─────────── */

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--body') out.body = argv[++i];
    else if (a === '--file') out.file = argv[++i];
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let body = args.body || '';
  if (args.file && fs.existsSync(args.file)) body = fs.readFileSync(args.file, 'utf8');
  if (!body && !process.stdin.isTTY) {
    try {
      body = fs.readFileSync(0, 'utf8').trim();
    } catch (e) {
      /* 无 stdin，忽略 */
    }
  }
  notify({ title: args.title, body, dryRun: args.dryRun }).then(r => {
    process.exit(r.failed > 0 && r.sent === 0 ? 1 : 0);
  });
}

module.exports = { notify };
