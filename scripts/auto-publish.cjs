#!/usr/bin/env node
/**
 * auto-publish.cjs - 一键发布
 * -----------------------------------------
 * 发送一条链接 → 自动整理成文章 → 自动发布推送
 *
 * 用法:
 *   node scripts/auto-publish.cjs <url>            # 自动发布
 *   node scripts/auto-publish.cjs <url> --no-push   # 只生成不推送
 *
 * 支持:
 *   - 微信公众号链接 (mp.weixin.qq.com) → 自动抓取原文
 *   - 抖音视频链接 (v.douyin.com / www.douyin.com/video/) → 抓取元数据
 *   - 抖音分享文本 → 从文本提取 URL + 作者 + 标题
 *   - 小红书笔记链接 (xhslink.com / xiaohongshu.com/explore/) → 抓取元数据
 *   - 小红书分享文本 → 从文本提取 URL + 标题
 *   - 自动 git commit + push
 */

var execSync = require('child_process').execSync;
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var IS_WIN = process.platform === 'win32';
var DEVNULL = IS_WIN ? 'NUL' : '/dev/null';
var UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
var UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------- 参数解析 ----------
var args = process.argv.slice(2);
var NO_PUSH = args.indexOf('--no-push') >= 0;
var input = '';
for (var i = 0; i < args.length; i++) {
  if (args[i].indexOf('--') !== 0) {
    input = args[i];
    break;
  }
}

if (!input) {
  console.error('用法: node scripts/auto-publish.cjs <url> [--no-push]');
  console.error('');
  console.error('示例:');
  console.error('  node scripts/auto-publish.cjs "https://mp.weixin.qq.com/s/xxx"');
  console.error('  node scripts/auto-publish.cjs "https://v.douyin.com/xxx/"');
  console.error('  node scripts/auto-publish.cjs "7.10 复制打开抖音，看看【作者名的作品】标题 https://v.douyin.com/xxx/"');
  console.error('  node scripts/auto-publish.cjs "http://xhslink.com/o/xxx"');
  console.error('  node scripts/auto-publish.cjs "网友说的是真的…吃的干净真的会瘦！！ http://xhslink.com/o/xxx"');
  process.exit(1);
}

// ---------- 工具函数 ----------
function extractUrl(text) {
  var m = text.match(/https?:\/\/[^\s"']+/);
  return m ? m[0].replace(/[,;]+$/, '') : text.trim();
}

function extractMeta(html, prop) {
  var patterns = [
    new RegExp('meta\\s+property=["\']' + prop + '["\']\\s+content=["\']([^"\']+)["\']'),
    new RegExp('meta\\s+content=["\']([^"\']+)["\']\\s+property=["\']' + prop + '["\']'),
    new RegExp('meta\\s+name=["\']' + prop + '["\']\\s+content=["\']([^"\']+)["\']'),
    new RegExp('meta\\s+content=["\']([^"\']+)["\']\\s+name=["\']' + prop + '["\']'),
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) return m[1];
  }
  return '';
}

function curlGet(url, options) {
  options = options || {};
  var cmd = 'curl -sSL --max-time 30';
  cmd += ' -A "' + (options.ua || UA_MOBILE) + '"';
  if (options.referer) cmd += ' -e "' + options.referer + '"';
  cmd += ' "' + url + '"';
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, cwd: ROOT });
}

function detectType(url) {
  if (/mp\.weixin\.qq\.com/.test(url)) return 'wechat';
  if (/v\.douyin\.com|www\.douyin\.com\/video|douyin\.com/.test(url)) return 'douyin';
  if (/xhslink\.com|xiaohongshu\.com|xhsurl\.com/.test(url)) return 'xiaohongshu';
  return 'unknown';
}

// 抖音分享文本解析: "7.10 复制打开抖音，看看【作者名的作品】标题... https://v.douyin.com/xxx/"
function parseDouyinShare(text) {
  var result = { url: '', author: '', title: '' };
  result.url = extractUrl(text);
  var authorMatch = text.match(/【(.+?)的作品】/);
  if (authorMatch) result.author = authorMatch[1];
  var titleMatch = text.match(/】(.+?)(?:\s*https?|\s*$)/);
  if (titleMatch) result.title = titleMatch[1].trim();
  return result;
}

// 小红书分享文本解析
function parseXhsShare(text) {
  var result = { url: '', author: '', title: '' };
  result.url = extractUrl(text);
  var lines = text.split(/[\n\r]+/).filter(function (l) { return l.trim(); });
  if (lines.length > 0) {
    var firstLine = lines[0].trim();
    if (!/^https?:\/\//.test(firstLine) && firstLine.length < 100) {
      result.title = firstLine;
    }
  }
  return result;
}

// ---------- 微信处理 ----------
function handleWechat(url) {
  console.log('📰 微信文章模式');
  console.log();
  execSync('node scripts/wx-post-quick.cjs "' + url + '"', { stdio: 'inherit', cwd: ROOT });
}

// ---------- 小红书处理 ----------
function handleXiaohongshu(rawInput) {
  console.log('📕 小红书笔记模式');
  console.log();

  var share = parseXhsShare(rawInput);
  var url = share.url;
  console.log('🔗 链接:', url);
  if (share.title) console.log('📝 标题(来自分享文本):', share.title);

  var finalUrl = url;
  if (/xhslink\.com|xhsurl\.com/.test(url)) {
    try {
      var redirectCmd =
        'curl -sSL --max-time 15 -o ' + DEVNULL + ' -w "%{url_effective}" -A "' + UA_MOBILE + '" "' + url + '"';
      finalUrl = execSync(redirectCmd, { encoding: 'utf8', cwd: ROOT }).trim();
      console.log('🔄 展开短链:', finalUrl);
    } catch (e) {
      console.log('⚠️ 短链展开失败，使用原始 URL');
    }
  }

  var noteId = '';
  var idMatch = finalUrl.match(/\/explore\/([a-zA-Z0-9]+)/);
  if (!idMatch) idMatch = finalUrl.match(/\/discovery\/item\/([a-zA-Z0-9]+)/);
  if (idMatch) noteId = idMatch[1];
  if (!noteId) {
    console.error('❌ 无法提取笔记 ID，链接格式不正确');
    process.exit(1);
  }
  console.log('🆔 笔记 ID:', noteId);

  var html = '';
  try {
    html = curlGet(finalUrl, { ua: UA_DESKTOP, referer: 'https://www.xiaohongshu.com/' });
  } catch (e) {
    console.error('❌ 页面抓取失败:', e.message);
    process.exit(1);
  }

  if (!html || html.length < 500) {
    console.error('❌ 页面内容过短，可能被反爬。HTML 长度:', html ? html.length : 0);
    process.exit(1);
  }
  console.log('✅ 抓取成功，HTML 长度:', html.length);

  var title = extractMeta(html, 'og:title') || share.title || '未知标题';
  var cover = extractMeta(html, 'og:image') || '';
  var author = '';

  var nicknameMatch = html.match(/"nickname":"([^"]+)"/);
  if (nicknameMatch) author = nicknameMatch[1];
  if (!author) {
    var authorMatch = html.match(/"user":\{[^}]*"nickname":"([^"]+)"/);
    if (authorMatch) author = authorMatch[1];
  }

  console.log('📝 标题:', title);
  console.log('✍️  作者:', author || '(未知)');
  console.log('🖼️  封面:', cover ? '已获取' : '(无)');

  var today = new Date().toISOString().slice(0, 10);
  var note = {
    id: 'xhs-' + noteId,
    title: title,
    eyebrow: '健康生活 · 小红书',
    author: author || '佚名',
    date: today,
    cover: cover,
    tags: ['健康生活', '小红书', '笔记'],
    summary: title + ' - 来自小红书笔记' + (author ? '，作者：' + author : ''),
    meta_desc: title + ' - 来自小红书笔记',
    meta_keywords: '小红书,笔记,' + (author || ''),
    duration: '约 5 分钟阅读',
    category: '健康生活',
    content_html: [
      '<div class="section-marker">01 · 笔记简介</div>',
      '<h2>笔记简介</h2>',
      '<p>本文来自小红书笔记，作者：' + (author || '佚名') + '。</p>',
      '<p>笔记标题：' + title + '</p>',
      '<div class="info-box">本文为自动抓取生成，详细内容待后续补充完善。健康类内容仅供参考，不构成医疗建议。</div>',
      '<div class="section-marker">02 · 原笔记</div>',
      '<h2>原笔记</h2>',
      '<p>点击下方按钮前往小红书查看原笔记。</p>',
    ],
    cta: {
      title: '去小红书看原笔记',
      desc: '点击跳转小红书原笔记页',
      url: finalUrl,
    },
    footer_meta: '本站内容纯学习用途，非商用。图片版权归小红书原作者所有。',
  };

  var tmpJson = path.join(os.tmpdir(), 'auto-publish-xhs-' + process.pid + '.json');
  fs.writeFileSync(tmpJson, JSON.stringify([note], null, 2), 'utf-8');
  console.log('📄 生成临时配置:', tmpJson);

  console.log();
  console.log('--- 生成文章 ---');
  try {
    execSync('node skills/xhs-post-skill/generate.js "' + tmpJson + '"', { stdio: 'inherit', cwd: ROOT });
  } finally {
    try {
      fs.unlinkSync(tmpJson);
    } catch (e) {
      /* ignore */
    }
  }
}

// ---------- 抖音处理 ----------
function handleDouyin(rawInput) {
  console.log('🎬 抖音视频模式');
  console.log();

  // 1. 解析输入
  var share = parseDouyinShare(rawInput);
  var url = share.url;
  console.log('🔗 链接:', url);
  if (share.author) console.log('✍️  作者(来自分享文本):', share.author);
  if (share.title) console.log('📝 标题(来自分享文本):', share.title);

  // 2. 跟随重定向获取最终 URL
  var finalUrl = url;
  if (url.indexOf('v.douyin.com') >= 0) {
    try {
      var redirectCmd =
        'curl -sSL --max-time 15 -o ' + DEVNULL + ' -w "%{url_effective}" -A "' + UA_MOBILE + '" "' + url + '"';
      finalUrl = execSync(redirectCmd, { encoding: 'utf-8', cwd: ROOT }).trim();
      console.log('🔄 展开短链:', finalUrl);
    } catch (e) {
      console.log('⚠️ 短链展开失败，使用原始 URL');
    }
  }

  // 3. 提取视频 ID
  var idMatch = finalUrl.match(/\/video\/(\d+)/);
  if (!idMatch) {
    console.error('❌ 无法提取视频 ID，链接格式不正确');
    process.exit(1);
  }
  var videoId = idMatch[1];
  console.log('🆔 视频 ID:', videoId);

  // 4. 抓取页面
  var html = '';
  try {
    html = curlGet(finalUrl, { ua: UA_DESKTOP, referer: 'https://www.douyin.com/' });
  } catch (e) {
    console.error('❌ 页面抓取失败:', e.message);
    process.exit(1);
  }

  if (!html || html.length < 500) {
    console.error('❌ 页面内容过短，可能被反爬。HTML 长度:', html ? html.length : 0);
    process.exit(1);
  }
  console.log('✅ 抓取成功，HTML 长度:', html.length);

  // 5. 提取元数据
  var title = extractMeta(html, 'og:title') || share.title || '未知标题';
  var cover = extractMeta(html, 'og:image') || '';
  var author = share.author || '';

  // 从页面 JSON 数据提取作者
  if (!author) {
    var nicknameMatch = html.match(/"nickname":"([^"]+)"/);
    if (nicknameMatch) author = nicknameMatch[1];
  }
  if (!author) {
    var authorMatch2 = html.match(/"author":\{[^}]*"name":"([^"]+)"/);
    if (authorMatch2) author = authorMatch2[1];
  }

  console.log('📝 标题:', title);
  console.log('✍️  作者:', author || '(未知)');
  console.log('🖼️  封面:', cover ? '已获取' : '(无)');

  // 6. 构造 videos.json
  var today = new Date().toISOString().slice(0, 10);
  var video = {
    id: 'dy-' + videoId,
    title: title,
    eyebrow: '抖音搬运',
    author: author || '佚名',
    date: today,
    cover: cover,
    tags: ['抖音', '视频', '搬运'],
    summary: title + ' - 来自抖音视频' + (author ? '，作者：' + author : ''),
    meta_desc: title + ' - 来自抖音视频',
    meta_keywords: '抖音,视频,' + (author || ''),
    duration: '约 5 分钟阅读',
    content_html: [
      '<div class="section-marker">01 · 视频简介</div>',
      '<h2>视频简介</h2>',
      '<p>本文来自抖音视频，作者：' + (author || '佚名') + '。</p>',
      '<p>视频标题：' + title + '</p>',
      '<div class="info-box">本文为自动抓取生成，详细内容待后续补充完善。</div>',
      '<div class="section-marker">02 · 原视频</div>',
      '<h2>原视频</h2>',
      '<p>点击下方按钮前往抖音观看原视频。</p>',
    ],
    cta: {
      title: '去抖音看原视频',
      desc: '点击跳转抖音原视频页',
      url: finalUrl,
    },
    footer_meta: '本站内容纯学习用途，非商用。视频封面版权归抖音原视频作者所有。',
  };

  // 7. 写入临时 JSON
  var tmpJson = path.join(os.tmpdir(), 'auto-publish-douyin-' + process.pid + '.json');
  fs.writeFileSync(tmpJson, JSON.stringify([video], null, 2), 'utf-8');
  console.log('📄 生成临时配置:', tmpJson);

  // 8. 调用 generate.js
  console.log();
  console.log('--- 生成文章 ---');
  try {
    execSync('node skills/douyin-post-skill/generate.js "' + tmpJson + '"', { stdio: 'inherit', cwd: ROOT });
  } finally {
    // 清理临时文件
    try {
      fs.unlinkSync(tmpJson);
    } catch (e) {
      /* ignore */
    }
  }
}

// ---------- 主流程 ----------
var url = extractUrl(input);
var type = detectType(url);

if (type === 'unknown') {
  console.error('❌ 不支持的链接: ' + url);
  console.error('支持: 微信公众号链接 (mp.weixin.qq.com)、抖音视频链接 (v.douyin.com)、小红书笔记链接 (xhslink.com)');
  process.exit(1);
}

var typeNames = {
  wechat: '微信公众号',
  douyin: '抖音视频',
  xiaohongshu: '小红书笔记',
};

console.log('=== 自动发布 ===');
console.log('🔗 链接:', url);
console.log('📂 类型:', typeNames[type] || type);
console.log();

if (type === 'wechat') {
  handleWechat(url);
} else if (type === 'douyin') {
  handleDouyin(input);
} else if (type === 'xiaohongshu') {
  handleXiaohongshu(input);
}

// ---------- 一致性检查 ----------
console.log();
console.log('--- 一致性检查 ---');
try {
  execSync('node scripts/repo-lint.cjs --fix', { stdio: 'inherit', cwd: ROOT });
} catch (e) {
  console.log('⚠️ 一致性检查发现问题，请根据上方输出手动修复');
}

// ---------- git commit + push ----------
if (!NO_PUSH) {
  console.log();
  console.log('--- 推送到 GitHub ---');
  try {
    execSync('git add -A', { stdio: 'inherit', cwd: ROOT });
    var commitMsg = 'feat: auto-publish ' + type + ' article';
    execSync('git commit -m "' + commitMsg + '"', { stdio: 'inherit', cwd: ROOT });
    execSync('git push origin HEAD:main', { stdio: 'inherit', cwd: ROOT });
    console.log();
    console.log('✅ 发布完成！');
  } catch (e) {
    console.error('❌ git 推送失败');
    console.error('文章已生成，请手动推送:');
    console.error('  git add -A && git commit -m "feat: auto-publish article" && git push origin HEAD:main');
  }
} else {
  console.log();
  console.log('✅ 生成完成（--no-push 模式，未推送）');
}
