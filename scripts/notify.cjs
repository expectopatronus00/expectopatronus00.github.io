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
 *   EMAIL_SMTP_USER + EMAIL_SMTP_PASS  邮件（SMTP，默认 smtp.163.com:465）
 *       可选：EMAIL_SMTP_HOST / EMAIL_SMTP_PORT / EMAIL_TO / EMAIL_FROM / EMAIL_FROM_NAME
 *       注意 163/126 的 EMAIL_SMTP_PASS 填「客户端授权密码」，不是登录密码。
 *
 * 配置写在仓库根目录 .env（已 gitignore），也支持直接给环境变量。
 * 无第三方依赖，只用 node 内置模块。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');

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

/* ─────────── SMTP 邮件（原生实现，零依赖） ─────────── */

/** RFC 2047 编码标题/地址显示名 */
function mimeWord(s) {
  return '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
}

/** 组装 MIME 报文：纯文本 + base64 正文，避免 8bit 与点号转义问题 */
function buildMime(cfg, title, body) {
  const b64 = Buffer.from(body || '', 'utf8')
    .toString('base64')
    .replace(/(.{1,76})/g, '$1\r\n');
  const from = cfg.fromName
    ? mimeWord(cfg.fromName) + ' <' + cfg.from + '>'
    : cfg.from;
  const headers = [
    'From: ' + from,
    'To: ' + cfg.to.join(', '),
    'Subject: ' + mimeWord(title),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@' +
      String(cfg.from).split('@')[1] + '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + b64;
}

/**
 * 最小 SMTP 客户端：465/994 隐式 TLS，25/587 明文 + STARTTLS。
 * 只实现 AUTH LOGIN + 单发件人多收件人，够 notify 用。
 */
function smtpSend(cfg, mail) {
  return new Promise((resolve, reject) => {
    const host = cfg.host || 'smtp.163.com';
    const port = Number(cfg.port) || 465;
    const implicit = port === 465 || port === 994;
    const timeout = 20000;

    let sock = null;
    let buf = '';
    let waiter = null;
    let settled = false;

    const finish = err => {
      if (settled) return;
      settled = true;
      try {
        if (sock) sock.end();
      } catch (e) {
        /* 忽略 */
      }
      err ? reject(err) : resolve({ ok: true });
    };

    const onData = chunk => {
      buf += chunk.toString('utf8');
      let m;
      while ((m = /^(\d{3})([ -])[^\r\n]*\r\n/.exec(buf)) !== null) {
        const code = Number(m[1]);
        const sep = m[2];
        buf = buf.slice(m[0].length);
        if (sep === '-') continue; // 多行响应续行
        const cb = waiter;
        waiter = null;
        if (cb) cb(code);
      }
    };

    const attach = s => {
      sock = s;
      sock.setTimeout(timeout);
      sock.on('data', onData);
      sock.on('error', e => finish(e));
      sock.on('timeout', () => finish(new Error('SMTP 超时')));
    };

    const expect = codes =>
      new Promise((res, rej) => {
        waiter = code => (codes.indexOf(code) >= 0 ? res(code) : rej(new Error('SMTP 返回 ' + code)));
      });

    const cmd = line => sock.write(line + '\r\n');

    const run = async () => {
      await expect([220]);
      cmd('EHLO ' + (cfg.ehloName || 'localhost'));
      await expect([250]);

      if (!implicit) {
        cmd('STARTTLS');
        await expect([220]);
        sock.removeListener('data', onData);
        const upgraded = tls.connect(
          { socket: sock, servername: host, rejectUnauthorized: false },
          () => {
            attach(upgraded);
            runTls();
          }
        );
        upgraded.on('error', e => finish(e));
        return;
      }
      await auth();
    };

    const runTls = async () => {
      cmd('EHLO ' + (cfg.ehloName || 'localhost'));
      await expect([250]);
      await auth();
    };

    const auth = async () => {
      cmd('AUTH LOGIN');
      await expect([334]);
      cmd(Buffer.from(cfg.user, 'utf8').toString('base64'));
      await expect([334]);
      cmd(Buffer.from(cfg.pass, 'utf8').toString('base64'));
      await expect([235]);

      cmd('MAIL FROM:<' + cfg.from + '>');
      await expect([250]);
      for (const rcpt of mail.to) {
        cmd('RCPT TO:<' + rcpt + '>');
        await expect([250, 251]);
      }
      cmd('DATA');
      await expect([354]);
      sock.write(mail.raw + '\r\n.\r\n');
      await expect([250]);
      try {
        cmd('QUIT');
      } catch (e) {
        /* 有些服务端直接断开 */
      }
      finish();
    };

    const onConnect = () => {
      run().catch(e => finish(e));
    };

    if (implicit) {
      attach(
        tls.connect({ host, port, servername: host, rejectUnauthorized: false }, onConnect)
      );
    } else {
      attach(net.connect({ host, port }, onConnect));
    }
  });
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

  if (env.EMAIL_SMTP_USER && env.EMAIL_SMTP_PASS) {
    const from = env.EMAIL_FROM || env.EMAIL_SMTP_USER;
    const to = (env.EMAIL_TO || env.EMAIL_SMTP_USER)
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean);
    const mailCfg = {
      host: env.EMAIL_SMTP_HOST || 'smtp.163.com',
      port: env.EMAIL_SMTP_PORT || 465,
      user: env.EMAIL_SMTP_USER,
      pass: env.EMAIL_SMTP_PASS,
      from,
      fromName: env.EMAIL_FROM_NAME || '博客信源雷达',
      to,
    };
    list.push({
      name: '邮件 ' + to.join(','),
      send: (title, body) =>
        smtpSend(mailCfg, {
          to,
          raw: buildMime(Object.assign({ to }, mailCfg), title, body),
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
