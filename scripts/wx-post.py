#!/usr/bin/env python3
import re, os, sys

URL = sys.argv[1] if len(sys.argv) > 1 else None
if not URL:
    print('需要 URL')
    sys.exit(1)

tmp_html = '/tmp/wx-in-%d.html' % os.getpid()

# 抓取
print('📡 抓取:', URL)
ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
r = os.system('curl -sSL --max-time 30 -A "%s" -H "Accept-Language: zh-CN,zh;q=0.9" -o "%s" "%s"' % (ua, tmp_html, URL))
with open(tmp_html, 'r', encoding='utf-8', errors='ignore') as f:
    html = f.read()

print('HTML 长度:', len(html))

# 标题
m = re.search(r'<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)<\/h1>', html)
title = re.sub(r'<[^>]+>', '', m.group(1)).strip() if m else ''

# 作者
m = re.search(r'article:author"\s+content="([^"]+)', html)
author = m.group(1) if m else ''

# 日期
m = re.search(r'article:published_time"\s+content="([^"]+)', html)
date = m.group(1)[:10] if m else '2026-06-20'

# 封面
m = re.search(r'og:image"[^>]*content="([^"]+)', html)
cover = m.group(1) if m else ''

print('标题:', title)
print('作者:', author)
print('日期:', date)
print('封面:', cover[:80])

# 正文
m = re.search(r'id="js_content"[^>]*>([\s\S]*?)<\/div>', html)
body = m.group(1) if m else ''
print('正文:', len(body), '字')

# 解析段落
blocks = re.findall(r'<(section|p|h[1-6]|div|blockquote)[^>]*>([\s\S]*?)<\/\1>', body, re.IGNORECASE)
print('段落数:', len(blocks))

def clean_text(s):
    s = re.sub(r'<br\s*/?>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
    return s.strip()

parsed = []
for tag, content in blocks:
    text = clean_text(content)
    if not text or len(text) < 3: continue
    img_match = re.search(r'<img[^>]*data-src="([^"]+)', content)
    if img_match and len(text) < 40:
        parsed.append(('img', img_match.group(1)))
        continue
    t = tag.lower()
    if t in ['h1', 'h2', 'h3']:
        parsed.append((t, text))
    elif len(text) < 80:
        if re.match(r'^第[\u4e00-\u9fa50-9]+[章回节篇]', text): parsed.append(('h2', text))
        elif re.match(r'^[一二三四五六七八九十][、\.]', text): parsed.append(('h2', text))
        elif re.match(r'^[\d]{1,2}[\.、][^\d]', text): parsed.append(('h2', text))
        elif re.match(r'^[\d]{1,2}\.[\d]{1,2}', text): parsed.append(('h3', text))
        else: parsed.append(('p', text))
    else:
        lines = text.split('\n')
        looks_like_code = any(
            (l.strip().startswith('$') or l.strip().startswith('#') or l.strip().startswith('curl') or
             l.strip().startswith('uv') or l.strip().startswith('python') or l.strip().startswith('npm')
             or l.strip().startswith('sudo') or l.strip().startswith('pip'))
            for l in lines if l.strip()
        )
        if looks_like_code or '\n' in text:
            parsed.append(('pre', text))
        else:
            parsed.append(('p', text))

# 构建章节
sections = []
current = {'title': '', 'items': []}
for item in parsed:
    t, d = item
    if t == 'h2':
        if current['title'] or current['items']:
            sections.append(current)
        current = {'title': d, 'items': []}
    elif t == 'h3':
        current['items'].append(('h3', d))
    elif t == 'pre':
        current['items'].append(('pre', d))
    elif t == 'img':
        current['items'].append(('img', d))
    else:
        current['items'].append(('p', d))
if current['title'] or current['items']:
    sections.append(current)

print('章节数:', len(sections))

# 摘要
summary = ''
for s in sections:
    for t, d in s['items']:
        if t == 'p' and len(d) > 30:
            summary = d
            break
    if summary:
        break
summary = summary.replace('\n', ' ')[:160]
print('摘要:', summary)

# slug
ascii_part = re.sub(r'[^\w\s-]', ' ', title).strip().lower()
words = [w for w in ascii_part.split() if len(w) > 2][:5]
if words:
    slug = '-'.join(words)
else:
    slug = 'post-' + date + '-wx'

i = 2
base = slug
while os.path.exists('post/' + slug):
    slug = base + '-' + str(i)
    i += 1

print('slug:', slug)

# 生成正文 HTML
body_lines = []
for si, sec in enumerate(sections):
    if sec['title']:
        body_lines.append('      <div class="section-marker on-scroll">%s · %s</div>' % (str(si+1).zfill(2), sec['title']))
        body_lines.append('      <h2 class="on-scroll">%s</h2>' % sec['title'])
    for t, d in sec['items']:
        if t == 'h3':
            body_lines.append('      <h3 class="on-scroll">%s</h3>' % d)
        elif t == 'p':
            lines = d.split('\n')
            for ln in lines:
                ln = ln.strip()
                if not ln: continue
                body_lines.append('      <p class="on-scroll">%s</p>' % ln)
        elif t == 'pre':
            body_lines.append('      <div class="info-box info-box-jade on-scroll"><p style="font-family: var(--font-mono); font-size: 0.85rem; white-space: pre-wrap;">%s</p></div>' % d)
        elif t == 'img':
            body_lines.append('      <div style="max-width: 100%; margin: var(--sp-5) 0; text-align: center;"><img loading="lazy" src="%s" alt="插图" style="max-width: 100%%; border-radius: var(--r-md);"/></div>' % d)

content_html = '\n'.join(body_lines)

# 文章模板
article = '''<!doctype html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>%s · EXPECTOPATRONUS</title>
    <meta name="description" content="%s" />
    <meta name="keywords" content="AI,大模型,技术,深度分析,vllm,DeepSeek" />
    <meta property="og:title" content="%s" />
    <meta property="og:type" content="article" />
    <meta property="og:description" content="%s" />
    <link rel="shortcut icon" href="../../home/logo.svg" type="image/svg+xml" />
    <script>
      (function () {
        try { var t = localStorage.getItem('theme') || 'dark'; if (t === 'light') document.documentElement.dataset.theme = 'light'; } catch (e) {}
      })();
    </script>
    <link rel="stylesheet" href="../../home/design-tokens.css" />
    <style>
      .icon { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; vertical-align: -0.125em; color: currentColor; flex-shrink: 0; }
      .icon svg { width: 100%; height: 100%; }
      .icon-sm { width: 0.82em; height: 0.82em; }
      .icon-lg { width: 1.3em; height: 1.3em; }
      .theme-icon { color: var(--accent-rust); }

      body {
        font-family: var(--font-serif);
        background: var(--bg-0);
        color: var(--text);
        line-height: 1.8;
        margin: 0;
        font-size: 1.05rem;
      }

      nav.site-nav {
        position: sticky; top: 0; z-index: 100;
        display: flex; align-items: center; justify-content: space-between;
        padding: var(--sp-4) var(--sp-6);
        background: rgba(10, 12, 15, 0.85);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--line);
        font-family: var(--font-mono);
      }
      nav.site-nav .brand { display: flex; align-items: center; gap: var(--sp-2); color: var(--text); font-weight: 600; text-decoration: none; }
      nav.site-nav .brand .logo {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 8px;
        background: var(--accent-rust); color: #fff; font-weight: 700; font-family: var(--font-display);
      }
      nav.site-nav .nav-links { display: flex; gap: var(--sp-5); align-items: center; }
      nav.site-nav .nav-links a { color: var(--text-soft); text-decoration: none; font-size: 0.92rem; }
      nav.site-nav .nav-links a:hover { color: var(--accent-rust); }
      nav.site-nav .nav-links a.is-active { color: var(--accent-rust); }
      .theme-btn {
        background: transparent; border: 1px solid var(--line); color: var(--text-soft);
        padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 0.85rem;
        transition: all 0.2s;
      }
      .theme-btn:hover { border-color: var(--accent-rust); color: var(--accent-rust); }

      section.page-head {
        max-width: 960px;
        margin: 0 auto;
        padding: var(--sp-10) var(--sp-6) var(--sp-6);
        border-bottom: 1px solid var(--line);
      }
      section.page-head .eyebrow {
        font-family: var(--font-mono); font-size: 0.8rem;
        color: var(--accent-rust); letter-spacing: 0.12em;
        text-transform: uppercase; margin-bottom: var(--sp-4);
      }
      section.page-head h1 {
        font-family: var(--font-display); font-weight: 500;
        font-size: clamp(1.8rem, 4vw, 2.8rem); line-height: 1.15;
        letter-spacing: -0.01em; margin: 0 0 var(--sp-4);
      }
      section.page-head > p { color: var(--text-soft); font-size: 1.1rem; max-width: 680px; }
      section.page-head .meta {
        display: flex; flex-wrap: wrap; gap: var(--sp-4);
        margin-top: var(--sp-5); font-family: var(--font-mono); font-size: 0.85rem;
        color: var(--text-dim);
      }
      section.page-head .meta span { display: inline-flex; align-items: center; gap: 6px; }
      section.page-head .meta svg { color: var(--accent-rust); }

      .hero-image {
        max-width: 960px; margin: var(--sp-6) auto 0;
        padding: 0 var(--sp-6);
      }
      .hero-image img {
        width: 100%; border-radius: 16px; display: block;
        border: 1px solid var(--line);
      }

      article.article-body {
        max-width: 760px;
        margin: 0 auto;
        padding: var(--sp-8) var(--sp-6) var(--sp-10);
      }
      article.article-body h2 {
        font-family: var(--font-display); font-weight: 500;
        font-size: 1.55rem; margin: var(--sp-8) 0 var(--sp-4);
        color: var(--text);
      }
      article.article-body h3 {
        font-family: var(--font-display); font-weight: 500;
        font-size: 1.15rem; margin: var(--sp-6) 0 var(--sp-3);
        color: var(--text);
      }
      article.article-body p {
        font-family: var(--font-serif); color: var(--text-soft);
        line-height: 1.9; margin: 0 0 var(--sp-4);
      }
      article.article-body p strong { color: var(--text); font-weight: 600; }

      .section-marker {
        font-family: var(--font-mono); font-size: 0.78rem;
        color: var(--accent-rust); letter-spacing: 0.08em;
        margin-top: var(--sp-8); margin-bottom: var(--sp-2);
      }

      .info-box {
        border-left: 3px solid var(--accent-rust);
        padding: var(--sp-3) var(--sp-4);
        margin: var(--sp-4) 0;
        background: rgba(200, 120, 80, 0.08);
        border-radius: 0 8px 8px 0;
        color: var(--text-soft);
      }
      .info-box.info-box-jade {
        border-left-color: #4a9b8a;
        background: rgba(74, 155, 138, 0.08);
      }
      .info-box p { margin: 0; }

      .platform-list {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--sp-3); margin: var(--sp-6) 0;
      }
      .platform-list a {
        display: flex; flex-direction: column; gap: 4px;
        padding: var(--sp-3);
        border: 1px solid var(--line); border-radius: 8px;
        color: var(--text-soft); text-decoration: none;
        font-family: var(--font-mono); font-size: 0.88rem;
        transition: all 0.2s;
      }
      .platform-list a:hover {
        border-color: var(--accent-rust); transform: translateY(-2px);
        background: rgba(200, 120, 80, 0.05);
      }
      .platform-list .pn { color: var(--text); font-weight: 500; }
      .platform-list .pd { color: var(--text-dim); font-size: 0.82rem; }

      .tags-row {
        display: flex; flex-wrap: wrap; gap: var(--sp-2);
        margin: var(--sp-8) 0 var(--sp-5);
        padding-top: var(--sp-5); border-top: 1px dashed var(--line);
      }
      .tags-row a {
        font-family: var(--font-mono); font-size: 0.82rem;
        padding: 4px 12px; border: 1px solid var(--line);
        border-radius: 20px; color: var(--text-soft); text-decoration: none;
        transition: all 0.2s;
      }
      .tags-row a:hover { border-color: var(--accent-rust); color: var(--accent-rust); }

      footer.site-footer {
        border-top: 1px solid var(--line);
        padding: var(--sp-6);
        margin-top: var(--sp-8);
        color: var(--text-dim);
        font-size: 0.85rem;
        font-family: var(--font-mono);
      }
      footer.site-footer .footer-content {
        max-width: 960px; margin: 0 auto;
        display: flex; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap;
      }
      footer.site-footer .footer-brand { color: var(--text); font-weight: 500; font-family: var(--font-display); }

      .floating-top {
        position: fixed; bottom: 24px; right: 24px; z-index: 50;
        background: #1a1f2a; color: var(--text);
        border: 1px solid var(--line); border-radius: 50%;
        width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; opacity: 0; transition: opacity 0.3s;
      }
      .floating-top.visible { opacity: 1; }
      .floating-top:hover { border-color: var(--accent-rust); }

      @media (max-width: 768px) {
        nav.site-nav .nav-links { gap: var(--sp-3); font-size: 0.85rem; }
        article.article-body { padding: var(--sp-6) var(--sp-4); }
        article.article-body h2 { font-size: 1.35rem; }
      }

      [data-theme="light"] nav.site-nav { background: rgba(248, 248, 245, 0.9); }
      [data-theme="light"] .floating-top { background: #fff; }
    </style>
  </head>
  <body>
    <nav class="site-nav">
      <div class="nav-inner" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-5);">
        <a href="../../index.html" class="brand"><span class="logo">E</span><span>expectopatronus</span></a>
        <div class="nav-links">
          <a href="../../index.html">首页</a>
          <a href="../../home/home.html" class="is-active">文章</a>
          <a href="../../post/deepseek/deepseek.html">DeepSeek</a>
        </div>
        <button id="theme-toggle" class="theme-btn" aria-label="主题切换">
          <svg class="icon theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 13.5A9 9 0 0 1 10.5 3a7.5 7.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </nav>

    <section class="page-head">
      <div class="eyebrow">微信搬运 · %s</div>
      <h1>%s</h1>
      <p>%s</p>
      <div class="meta">
        <span><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 20c1.2-3.5 4-5 6.5-5s5.3 1.5 6.5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg> %s</span>
        <span><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> %s</span>
      </div>
      <div class="hero-image"><img loading="lazy" src="%s" alt="%s"/></div>
    </section>

    <article class="article-body">
%s
    </article>

    <footer class="site-footer">
      <div class="footer-content">
        <div>
          <div class="footer-brand">expectopatronus</div>
          <div class="footer-meta">© 2025 · 本站内容纯学习用途，非商用。原文版权归微信原作者所有。</div>
        </div>
      </div>
    </footer>

    <button class="floating-top" id="back-to-top" aria-label="返回顶部"><svg class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>

    <script>
      (function () {
        var MOON_SVG = '<path d="M21 13.5A9 9 0 0 1 10.5 3a7.5 7.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';
        var SUN_SVG = '<circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
        var saved = localStorage.getItem('theme') || 'dark';
        if (saved === 'light') document.documentElement.dataset.theme = 'light';
        var btnSvg = document.querySelector('#theme-toggle svg');
        if (btnSvg) btnSvg.innerHTML = saved === 'light' ? SUN_SVG : MOON_SVG;
        var btn = document.getElementById('theme-toggle');
        if (btn)
          btn.addEventListener('click', function () {
            var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
            document.documentElement.dataset.theme = next;
            localStorage.setItem('theme', next);
            var btnSvg2 = document.querySelector('#theme-toggle svg');
            if (btnSvg2) btnSvg2.innerHTML = next === 'light' ? SUN_SVG : MOON_SVG;
          });
        var back = document.getElementById('back-to-top');
        window.addEventListener('scroll', function () {
          if (back) back.classList.toggle('visible', window.scrollY > 300);
        });
        if (back)
          back.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      })();
    </script>
  </body>
</html>
''' % (title, summary, title, summary, slug, title, summary, author, date, cover, title, content_html)

os.makedirs('post/' + slug, exist_ok=True)
outpath = 'post/%s/%s.html' % (slug, slug)
with open(outpath, 'w', encoding='utf-8') as f:
    f.write(article)
print('✅ 生成文章:', outpath, '大小:', os.path.getsize(outpath))

# ===== 更新 home.html =====
home_path = 'home/home.html'
with open(home_path, 'r', encoding='utf-8') as f:
    home = f.read()

anchor = 'var articles = ['
idx = home.find(anchor)
if idx >= 0:
    after = home.index('\n', idx + len(anchor))
    title_q = title.replace("'", "\\'")
    summary_q = summary.replace("'", "\\'")
    entry = """          {
            id: '%s',
            title: '%s',
            url: '../post/%s/%s.html',
            summary: '%s',
            category: '微信搬运',
            date: '%s',
            tags: ['vllm', 'DeepSeek', '大模型', '本地部署'],
          },
""" % (slug, title_q, slug, slug, summary_q, date)
    home = home[:after+1] + entry + home[after+1:]
    home = re.sub(r'共 (\d+) 篇', lambda m: '共 ' + str(int(m.group(1)) + 1) + ' 篇', home, count=1)
    with open(home_path, 'w', encoding='utf-8') as f:
        f.write(home)
    print('✅ 更新 home.html')

# ===== 更新 index.html =====
index_path = 'index.html'
with open(index_path, 'r', encoding='utf-8') as f:
    index = f.read()

index = re.sub(
    r'(<div class="num">)(\d+)(</div>)',
    lambda m: m.group(1) + str(int(m.group(2)) + 1) + m.group(3),
    index,
    count=1
)

grid_anchor = 'class="latest-grid"'
idx2 = index.find(grid_anchor)
if idx2 >= 0:
    after_open = index.index('>', idx2)
    card = """
        <a class="article-card" href="post/%s/%s.html">
          <div
            class="thumb"
            style="background-image: url('%s')"
          >
            <span class="cat-badge">微信搬运</span>
          </div>
          <div class="art-body">
            <div class="date">%s</div>
            <h3>%s</h3>
            <p>%s</p>
          </div>
        </a>
""" % (slug, slug, cover, date, title, summary)
    index = index[:after_open+1] + card + index[after_open+1:]
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(index)
    print('✅ 更新 index.html')

print('\n🎉 完成！slug:', slug)
