#!/usr/bin/env python3
import re, os, sys

URL = sys.argv[1] if len(sys.argv) > 1 else None
if not URL:
    print('需要 URL')
    sys.exit(1)

tmp_html = '/tmp/wx-desktop.html'

# 如果文件存在且够大，跳过下载
need_download = True
if os.path.exists(tmp_html):
    sz = os.path.getsize(tmp_html)
    if sz > 10000:
        print('使用已下载的 HTML 文件 (%d 字节)' % sz)
        need_download = False

if need_download:
    print('抓取:', URL)
    ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    os.system('curl -sSL --max-time 30 -A "%s" -H "Accept-Language: zh-CN,zh;q=0.9" -o "%s" "%s"' % (ua, tmp_html, URL))
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
        if re.match(r'^第[\u4e00-\u9fa50-9]+[章回节篇]', text):
            parsed.append(('h2', text))
        elif re.match(r'^[一二三四五六七八九十][、\.]', text):
            parsed.append(('h2', text))
        elif re.match(r'^[\d]{1,2}[\.、][^\d]', text):
            parsed.append(('h2', text))
        elif re.match(r'^[\d]{1,2}\.[\d]{1,2}', text):
            parsed.append(('h3', text))
        else:
            parsed.append(('p', text))
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
    if summary: break
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
        body_lines.append('      <div class="section-marker on-scroll">' + str(si+1).zfill(2) + ' · ' + sec['title'] + '</div>')
        body_lines.append('      <h2 class="on-scroll">' + sec['title'] + '</h2>')
    for t, d in sec['items']:
        if t == 'h3':
            body_lines.append('      <h3 class="on-scroll">' + d + '</h3>')
        elif t == 'p':
            lines = d.split('\n')
            for ln in lines:
                ln = ln.strip()
                if not ln: continue
                body_lines.append('      <p class="on-scroll">' + ln + '</p>')
        elif t == 'pre':
            body_lines.append('      <div class="info-box info-box-jade on-scroll"><p style="font-family: var(--font-mono); font-size: 0.85rem; white-space: pre-wrap;">' + d + '</p></div>')
        elif t == 'img':
            body_lines.append('      <div style="max-width: 100%; margin: var(--sp-5) 0; text-align: center;"><img loading="lazy" src="' + d + '" alt="插图" style="max-width: 100%; border-radius: var(--r-md);"/></div>')

content_html = '\n'.join(body_lines)

# 生成文章 - 使用 replace 避免 % 冲突
ARTICLE_TEMPLATE = open('scripts/wx-template.html', 'r', encoding='utf-8').read()

article = ARTICLE_TEMPLATE.replace('@TITLE@', title).replace('@SUMMARY@', summary).replace('@SLUG@', slug).replace('@AUTHOR@', author).replace('@DATE@', date).replace('@COVER@', cover).replace('@CONTENT@', content_html)

os.makedirs('post/' + slug, exist_ok=True)
outpath = 'post/' + slug + '/' + slug + '.html'
with open(outpath, 'w', encoding='utf-8') as f:
    f.write(article)
print('生成文章:', outpath, '大小:', os.path.getsize(outpath))

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
            id: '""" + slug + """',
            title: '""" + title_q + """',
            url: '../post/""" + slug + '/' + slug + """.html',
            summary: '""" + summary_q + """',
            category: '微信搬运',
            date: '""" + date + """',
            tags: ['vllm', 'DeepSeek', '大模型', '本地部署'],
          },
"""
    home = home[:after+1] + entry + home[after+1:]
    home = re.sub(r'共 (\d+) 篇', lambda m: '共 ' + str(int(m.group(1)) + 1) + ' 篇', home, count=1)
    with open(home_path, 'w', encoding='utf-8') as f:
        f.write(home)
    print('更新 home.html')

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
        <a class="article-card" href="post/""" + slug + '/' + slug + """.html">
          <div
            class="thumb"
            style="background-image: url('""" + cover + """')"
          >
            <span class="cat-badge">微信搬运</span>
          </div>
          <div class="art-body">
            <div class="date">""" + date + """</div>
            <h3>""" + title + """</h3>
            <p>""" + summary + """</p>
          </div>
        </a>
"""
    index = index[:after_open+1] + card + index[after_open+1:]
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(index)
    print('更新 index.html')

print('完成！slug:', slug)
