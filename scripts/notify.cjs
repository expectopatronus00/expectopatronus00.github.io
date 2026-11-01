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

/* ─────────── 邮件正文排版 ───────────
   纯文本照旧保留（部分客户端与转发场景只认 text/plain），
   同时生成一份 HTML 版：表格布局 + 全内联样式，Outlook / 163 / Gmail 都能正常渲染。
   配色沿用站内 light 主题：暖纸底、墨色字、赭橙点缀。 */

const MAIL = {
  paper: '#f4efe4',
  card: '#fffdf8',
  line: '#e2d9c6',
  ink: '#2a2518',
  body: '#3a3323',
  muted: '#8a8069',
  rust: '#b8581d',
  jade: '#2f7d5d',
  red: '#a32d2d',
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:' + MAIL.ink + ';font-weight:600">$1</strong>');
  out = out.replace(
    /`([^`]+)`/g,
    '<code style="font-family:\'SF Mono\',Menlo,Consolas,monospace;font-size:12px;background:#f0e9da;padding:1px 5px;border-radius:4px;color:' + MAIL.rust + '">$1</code>'
  );
  out = out.replace(
    /(https?:\/\/[^\s<）)】]+)/g,
    '<a href="$1" style="color:' + MAIL.rust + ';text-decoration:none;border-bottom:1px dotted #d9b9a0">$1</a>'
  );
  return out;
}

/** 去掉正文开头重复的标题（日报正文第一行常常是「标题（补充说明）」） */
function stripEchoTitle(title, body) {
  const lines = String(body || '').split(/\r?\n/);
  const i = lines.findIndex(l => l.trim());
  if (i < 0) return body || '';
  const norm = s => s.replace(/[\s·—\-|]/g, '');
  if (norm(lines[i]).indexOf(norm(title)) === 0) {
    let rest = lines[i].trim().slice(String(title).length).trim();
    rest = rest.replace(/^[·—\-|:：]+/, '').trim();
    lines[i] = rest;
    if (!rest) lines.splice(i, 1);
  }
  return lines.join('\n');
}

/** 「标题：xxx」开头的正文 → 元信息两栏表 + 剩余段落。用于成稿通知。 */
function metaBlocks(lines) {
  const rows = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    // 标签不能是纯数字，否则「22:30 的 daily-run…」会被切成标签「22」
    const m = t.match(/^([^\d\s：:]{1,8})[：:]\s*(.+)$/);
    if (!m) break;
    rows.push({ k: m[1], v: m[2] });
  }
  const rest = lines.slice(i).join('\n');

  let html =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="margin:2px 0 18px;border-top:1px solid ' + MAIL.line + ';">';
  rows.forEach(r => {
    const isUrl = /^https?:\/\/\S+$/.test(r.v);
    const val = isUrl
      ? '<a href="' + escapeHtml(r.v) + '" style="display:inline-block;background:' + MAIL.rust +
        ';color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">打开链接</a>'
      : mdInline(r.v);
    html +=
      '<tr>' +
      '<td style="width:92px;padding:9px 0;border-bottom:1px solid #f2ece0;font-size:13px;color:' +
      MAIL.muted + ';vertical-align:top;white-space:nowrap;">' + escapeHtml(r.k) + '</td>' +
      '<td style="padding:9px 0;border-bottom:1px solid #f2ece0;font-size:14px;line-height:1.7;color:' +
      MAIL.ink + ';">' + val + '</td>' +
      '</tr>';
  });
  html += '</table>';

  return html + (rest.trim() ? mdBlocks(rest) : '');
}

/** 轻量文本 → 邮件 HTML 块。认标题、【小节】、·/- 列表、数字列表、**粗体**、`代码`、裸链接。 */
function mdBlocks(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let list = null; // { tag, items }

  // 成稿通知固定以「标题：」开头，走元信息表
  const firstIdx = lines.findIndex(l => l.trim());
  if (firstIdx >= 0 && /^标题[：:]/.test(lines[firstIdx].trim())) {
    return metaBlocks(lines.slice(firstIdx));
  }

  const flush = () => {
    if (!list) return;
    const tag = list.tag;
    const style =
      tag === 'ol'
        ? 'margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.85;color:' + MAIL.body
        : 'margin:0 0 14px;padding-left:18px;font-size:15px;line-height:1.85;color:' + MAIL.body;
    out.push(
      '<' + tag + ' style="' + style + '">' +
        list.items
          .map(
            it =>
              '<li style="margin:0 0 7px;padding-left:2px">' + mdInline(it) + '</li>'
          )
          .join('') +
        '</' + tag + '>'
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }

    const h = line.match(/^【(.+)】$/) || line.match(/^#{2,4}\s*(.+)$/);
    if (h) {
      flush();
      out.push(
        '<div style="margin:22px 0 10px;padding-left:10px;border-left:2px solid ' + MAIL.rust + ';' +
          "font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;letter-spacing:.06em;color:" + MAIL.muted + '">' +
          mdInline(h[1]) +
          '</div>'
      );
      continue;
    }

    // 「建议发布（≥75，4 条）：」这类短行当小节标题，比正文更像目录
    if (/^.{2,26}[：:]$/.test(line)) {
      flush();
      out.push(
        '<div style="margin:20px 0 8px;padding-left:10px;border-left:2px solid ' + MAIL.line + ';' +
          'font-size:13px;font-weight:600;letter-spacing:.02em;color:' + MAIL.ink + '">' +
          mdInline(line.replace(/[：:]$/, '')) +
          '</div>'
      );
      continue;
    }

    const ul = line.match(/^[·•*\-]\s+(.+)$/);
    if (ul) {
      if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; }
      list.items.push(ul[1]);
      continue;
    }

    const ol = line.match(/^(\d+)[.、)]\s+(.+)$/);
    if (ol) {
      if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; }
      list.items.push(ol[2]);
      continue;
    }

    flush();
    out.push(
      '<p style="margin:0 0 12px;font-size:15px;line-height:1.85;color:' + MAIL.body + '">' + mdInline(line) + '</p>'
    );
  }
  flush();
  return out.join('');
}

function kindStyle(kind, title) {
  const k = kind || (/失败|异常|错误|告警|FAIL/i.test(String(title)) ? 'alert' : 'report');
  if (k === 'alert') return { accent: MAIL.red, label: '需要处理' };
  if (k === 'ok') return { accent: MAIL.jade, label: '运行正常' };
  return { accent: MAIL.rust, label: '每日自动化' };
}

/** 组装 HTML 邮件：600px 表格布局，全内联样式，不依赖任何外部资源 */
function buildHtml(cfg, title, body, kind, rawHtml) {
  const k = kindStyle(kind, title);
  const stamp = new Date().toISOString().slice(0, 10);
  const inner = rawHtml || mdBlocks(stripEchoTitle(title, body));

  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<title>' + escapeHtml(title) + '</title>',
    '</head>',
    '<body style="margin:0;padding:0;background:' + MAIL.paper + ';">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + MAIL.paper + ';">',
    '<tr><td align="center" style="padding:28px 12px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:' + MAIL.card + ';border:1px solid ' + MAIL.line + ';border-radius:14px;overflow:hidden;">',

    // 顶部强调条
    '<tr><td style="height:3px;background:' + k.accent + ';font-size:0;line-height:0;">&nbsp;</td></tr>',

    // 眉标 + 标题
    '<tr><td style="padding:26px 32px 0;">',
    '<div style="font-family:\'SF Mono\',Menlo,Consolas,monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:' + k.accent + ';">',
    escapeHtml(k.label) + ' · ' + stamp,
    '</div>',
    '<h1 style="margin:10px 0 0;font-family:Georgia,\'Songti SC\',\'SimSun\',serif;font-size:26px;line-height:1.35;font-weight:500;color:' + MAIL.ink + ';">',
    escapeHtml(title),
    '</h1>',
    '</td></tr>',

    // 分隔线
    '<tr><td style="padding:16px 32px 0;"><div style="height:1px;background:' + MAIL.line + ';font-size:0;line-height:0;">&nbsp;</div></td></tr>',

    // 正文
    '<tr><td style="padding:18px 32px 6px;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;">',
    inner,
    '</td></tr>',

    // 页脚
    '<tr><td style="padding:18px 32px 26px;">',
    '<div style="border-top:1px solid ' + MAIL.line + ';padding-top:14px;font-family:-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;font-size:12px;line-height:1.9;color:' + MAIL.muted + ';">',
    '由 expectopatronus 的每日自动化发出 · ',
    '<a href="https://expectopatronus00.github.io" style="color:' + MAIL.rust + ';text-decoration:none;">expectopatronus00.github.io</a>',
    '<br>星标与热度会变，判断请回到仓库本身。',
    '</div>',
    '</td></tr>',

    '</table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');
}

function chunk76(b64) {
  return b64.replace(/(.{1,76})/g, '$1\r\n').replace(/\r\n$/, '');
}

/** 组装 MIME 报文：multipart/alternative，纯文本 + HTML 双份，均 base64 */
function buildMime(cfg, title, body, html) {
  const from = cfg.fromName ? mimeWord(cfg.fromName) + ' <' + cfg.from + '>' : cfg.from;
  const boundary = '----=_blog_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const headers = [
    'From: ' + from,
    'To: ' + cfg.to.join(', '),
    'Subject: ' + mimeWord(title),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@' +
      String(cfg.from).split('@')[1] + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
  ];

  const textPart = [
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    chunk76(Buffer.from(body || '', 'utf8').toString('base64')),
  ].join('\r\n');

  const htmlPart = [
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    chunk76(Buffer.from(html || '', 'utf8').toString('base64')),
  ].join('\r\n');

  return (
    headers.join('\r\n') + '\r\n\r\n' +
    textPart + '\r\n' + htmlPart + '\r\n--' + boundary + '--\r\n'
  );
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
      send: (title, body, extra) => {
        const cfg = Object.assign({ to }, mailCfg);
        const html = buildHtml(cfg, title, body, extra && extra.kind, extra && extra.html);
        return smtpSend(cfg, { to, raw: buildMime(cfg, title, body, html) });
      },
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
  const extra = { kind: opts.kind, html: opts.html };

  // 预览：把 HTML 版写到本地文件，不发送
  if (opts.saveHtml) {
    const fs = require('fs');
    const html = buildHtml({ to: [] }, title, body, opts.kind, opts.html);
    fs.writeFileSync(opts.saveHtml, html, 'utf8');
    console.log('已写出 HTML 预览 ' + opts.saveHtml);
  }

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
      r = await ch.send(title, body, extra);
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
    else if (a === '--kind') out.kind = argv[++i];
    else if (a === '--html') out.htmlFile = argv[++i];
    else if (a === '--save-html') out.saveHtml = argv[++i];
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
  // --html 传一个 HTML 片段文件，直接替代自动排版（适合需要表格 / 图表的自定义邮件）
  const html =
    args.htmlFile && fs.existsSync(args.htmlFile)
      ? fs.readFileSync(args.htmlFile, 'utf8')
      : undefined;
  notify({
    title: args.title,
    body,
    kind: args.kind,
    html,
    saveHtml: args.saveHtml,
    dryRun: args.dryRun,
  }).then(r => {
    process.exit(r.failed > 0 && r.sent === 0 ? 1 : 0);
  });
}

module.exports = { notify, buildHtml, mdBlocks };
