#!/usr/bin/env python3
import re, os, sys

URL = sys.argv[1] if len(sys.argv) > 1 else None
if not URL:
    print('需要 URL')
    sys.exit(1)

tmp_html = '/tmp/wx-desktop.html'

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

# ===== 解析元数据 =====
m = re.search(r'<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)<\/h1>', html)
title = re.sub(r'<[^>]+>', '', m.group(1)).strip() if m else ''

m = re.search(r'article:author"\s+content="([^"]+)', html)
author = m.group(1) if m else ''

m = re.search(r'article:published_time"\s+content="([^"]+)', html)
date = m.group(1)[:10] if m else '2026-06-20'

m = re.search(r'og:image"[^>]*content="([^"]+)', html)
cover = m.group(1) if m else ''

print('标题:', title)
print('作者:', author)
print('日期:', date)
print('封面:', cover[:60])

# ===== 解析正文 =====
m = re.search(r'id="js_content"[^>]*>([\s\S]*?)<\/div>', html)
body = m.group(1) if m else ''

# 清理文本
text = re.sub(r'<br\s*/?>', '\n', body)
text = re.sub(r'<[^>]+>', ' ', text)
text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
text = re.sub(r'\s{2,}', ' ', text).strip()

print('正文长度:', len(text))

# ===== 智能切分 =====
# 大章节： "1. xxx", "2. xxx", "3. xxx"
# 小节： "3.1 xxx", "4.1 xxx"

# 先按大章节切分
sections_raw = re.split(r'(?=\s)(\d{1,2}\.\s[\u4e00-\u9fa5A-Za-z])', text)
# 合并拆分结果
sections = []
i = 0
while i < len(sections_raw):
    if i > 0 and re.match(r'^\d{1,2}\.\s[\u4e00-\u9fa5A-Za-z]', sections_raw[i]):
        # 前一个分割的尾和当前标题合并
        sections[-1] = sections[-1] + sections_raw[i] + sections_raw[i+1] if i+1 < len(sections_raw) else sections[-1] + sections_raw[i]
        if i+1 < len(sections_raw):
            i += 2
        else:
            i += 1
    else:
        sections.append(sections_raw[i])
        i += 1

# 另一种更直接的方式：用正则找到所有大章节的位置
positions = []
for match in re.finditer(r'(?:^|[\s,，。；])(\d{1,2})\.\s*([\u4e00-\u9fa5A-Za-z])', text):
    # 确保是大章节标题（而不是 "3.1 xxx" 这种）
    # 检查后面没有紧跟另一个 .
    num_str = match.group(1)
    pos = match.start()
    # 如果前一个字符是数字或点，说明是小节编号（3.1）跳过
    prefix = text[max(0, pos-3):pos]
    if re.search(r'\d\.$', prefix.strip()):
        continue  # 是 3.1 的 .1
    positions.append(pos)

# 确保第一段是章节开头
if positions and positions[0] > 10:
    positions.insert(0, 0)
elif not positions:
    positions = [0]

print('章节位置:', positions[:10], '...')

# 切分章节
sections_text = []
for i in range(len(positions)):
    start = positions[i]
    end = positions[i+1] if i+1 < len(positions) else len(text)
    sections_text.append(text[start:end].strip())

print('大章节数:', len(sections_text))

# 生成正文 HTML
body_lines = []
for si, stext in enumerate(sections_text):
    # 提取章节标题（首字符为 "1. xxx"）
    title_match = re.match(r'(\d{1,2})\.\s*([^\s\d][^。\s]{0,20}|[\u4e00-\u9fa5A-Za-z]+)', stext)
    sec_title = ''
    content_start = 0
    if title_match:
        # 找出标题到第一个句号或换行的位置
        rest = stext[title_match.end():]
        # 标题一般短，最多取 15 个字符或到句号
        title_end_match = re.search(r'([。]|vllm|DeepSeek|GPU|[\d]{2,})', rest[:30])
        if title_end_match:
            title_text = rest[:title_end_match.start()].strip()
        else:
            # 取前 12 字
            title_text = rest[:12].strip()
        sec_title = title_match.group(1) + '. ' + title_text
        content_start = title_match.end()
        # 进一步微调：如果 title_text 结尾不完整，再找更合适的结束点
        # 简化：用第一句话作为标题
        # 找到第一个句号
        first_period = stext.find('。', content_start)
        if first_period > 0 and first_period - content_start < 80:
            # 第一句话完整，标题从首章编号
            pass
        body_lines.append('      <div class="section-marker on-scroll">' + str(si+1).zfill(2) + ' · ' + sec_title + '</div>')
        body_lines.append('      <h2 class="on-scroll">' + sec_title + '</h2>')

    # 处理章节内容
    content = stext[content_start:].strip()

    # 切分为小节（3.1 xxx, 4.1 xxx 等）
    sub_parts = []
    sub_positions = [0]
    for m2 in re.finditer(r'(?:[\s,，。；])(\d{1,2}\.\d{1,2})\s+', content):
        sub_positions.append(m2.start())
    if len(sub_positions) > 1:
        for j in range(len(sub_positions)):
            s = sub_positions[j]
            e = sub_positions[j+1] if j+1 < len(sub_positions) else len(content)
            sub_parts.append(content[s:e].strip())
    else:
        sub_parts = [content]

    for part in sub_parts:
        # 去除开头的 "3.1 xxx " 作为 h3 标题
        h3_match = re.match(r'(\d{1,2}\.\d{1,2})\s+([^\s。]+)', part)
        if h3_match:
            h3_title = h3_match.group(1) + ' ' + h3_match.group(2)
            body_lines.append('      <h3 class="on-scroll">' + h3_title + '</h3>')
            part = part[h3_match.end():].strip()

        # 检查是否是代码块
        if re.search(r'(\$|curl\s|uv\s|python\s|--model|--tensor|nvidia-smi|from\s|import\s)', part) and len(part) > 100:
            # 是代码或命令文本块
            body_lines.append('      <div class="info-box info-box-jade on-scroll"><p style="font-family: var(--font-mono); font-size: 0.85rem; white-space: pre-wrap; word-break: break-all;">' + part + '</p></div>')
        elif len(part) > 500:
            # 长段落：按句号切分
            sentences = re.split(r'(?<=。)', part)
            current_p = ''
            for sent in sentences:
                sent = sent.strip()
                if not sent: continue
                if len(current_p) + len(sent) < 250:
                    current_p += sent
                else:
                    if current_p:
                        body_lines.append('      <p class="on-scroll">' + current_p + '</p>')
                    current_p = sent
            if current_p:
                body_lines.append('      <p class="on-scroll">' + current_p + '</p>')
        else:
            body_lines.append('      <p class="on-scroll">' + part + '</p>')

content_html = '\n'.join(body_lines)
print('生成段落数:', len(body_lines))

# ===== 摘要 =====
# 从第一个非标题段落取
summary = ''
for bl in body_lines:
    if 'section-marker' in bl or '<h2' in bl or '<h3' in bl:
        continue
    m2 = re.search(r'<p[^>]*>(.*?)</p>', bl)
    if m2:
        summary = m2.group(1)
        if len(summary) > 50: break
summary = summary[:160]
if not summary:
    # 从正文第一部分取
    summary = text[:160]
print('摘要:', summary)

# ===== slug =====
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

# ===== 生成文章 =====
ARTICLE_TEMPLATE = open('scripts/wx-template.html', 'r', encoding='utf-8').read()
article = ARTICLE_TEMPLATE.replace('@TITLE@', title).replace('@SUMMARY@', summary).replace('@SLUG@', slug).replace('@AUTHOR@', author).replace('@DATE@', date).replace('@COVER@', cover).replace('@CONTENT@', content_html)

os.makedirs('post/' + slug, exist_ok=True)
outpath = 'post/' + slug + '/' + slug + '.html'
with open(outpath, 'w', encoding='utf-8') as f:
    f.write(article)
print('文章:', outpath, '大小:', os.path.getsize(outpath))

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
