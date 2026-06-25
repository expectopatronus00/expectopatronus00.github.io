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

text = re.sub(r'<br\s*/?>', '\n', body)
text = re.sub(r'<[^>]+>', ' ', text)
text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
text = re.sub(r'\s{2,}', ' ', text).strip()
print('正文长度:', len(text))

# ===== 智能切分 =====
# 先找出所有大章节（1. xxx, 2. xxx）的起始位置
# 排除 3.1 这种小节编号
major_positions = []
for match in re.finditer(r'(^|[\s,，。；])(\d{1,2})\.\s+([\u4e00-\u9fa5A-Za-z])', text):
    num = int(match.group(2))
    # 如果前面有 "数字." 模式（比如 3.1），排除
    prefix = text[max(0, match.start()-10):match.start()]
    if re.search(r'\d\.\s*$', prefix) or re.search(r'[\u4e00-\u9fa5]\.\d+$', prefix):
        # 这是小节编号，不是大章节
        continue
    # 更严格：确保数字是连续章节编号
    if num >= 1:
        major_positions.append((match.start(), num, match.group(3)))

print('候选大章节:', [(pos, n) for pos, n, _ in major_positions[:10]])

# 过滤 - 确保编号递增
filtered = []
expected_next = 1
for pos, n, ch in major_positions:
    if n == expected_next:
        filtered.append((pos, n, ch))
        expected_next += 1
    elif n > expected_next:
        # 跳号了，可能不是章节
        continue

# 如果没有找到大章节，用全文
if not filtered:
    filtered = [(0, 1, '正文')]
elif filtered[0][0] > 0:
    filtered.insert(0, (0, 0, ''))

print('最终大章节位置:', [(pos, n) for pos, n, _ in filtered])

# 切分章节
sections_text = []
for i in range(len(filtered)):
    start = filtered[i][0]
    end = filtered[i+1][0] if i+1 < len(filtered) else len(text)
    sections_text.append(text[start:end].strip())

print('大章节数:', len(sections_text))

def extract_chinese_sentence(text, max_len=20):
    """从文本开头提取中文句子作为标题"""
    # 找第一个句号
    period = text.find('。')
    if period > 0 and period < max_len:
        return text[:period]
    # 如果没有句号，找第一个英文句号
    period = text.find('.')
    if period > 0 and period < max_len:
        return text[:period]
    # 否则取前 max_len 个字符
    return text[:max_len]

def is_valid_h3(text_segment):
    """检查是否是合法的小节标题（3.1 xxx 形式，排除纯数字版本号）"""
    # 合法：数字.数字 后面跟中文/英文字母
    # 非法：类似 "13.0"、"12.8" 这种版本号
    # 非法：类似 "0.7 }'" 这种 JSON 数字
    m = re.match(r'(\d{1,2})\.(\d{1,2})\s+([\u4e00-\u9fa5A-Za-z]+)', text_segment)
    if not m:
        return False
    # 检查是不是版本号上下文
    # 如果前面文本包含 "CUDA"、"cuda"、"驱动"、"vLLM" 等，可能是版本号
    # 更简单的方式：检查标题是否包含实际中文单词（至少 2 个汉字）
    title_part = m.group(3)
    chinese_count = len(re.findall(r'[\u4e00-\u9fa5]', title_part))
    if chinese_count >= 2:
        return True
    # 或标题是英文名词（如 "Download"）
    if len(title_part) >= 3 and title_part.replace(' ', '').isalpha():
        return True
    return False

# 生成正文 HTML
body_lines = []
for si, stext in enumerate(sections_text):
    # 提取章节标题
    num_match = re.match(r'(\d{1,2})\.\s+', stext)
    sec_title = ''
    content_start = 0
    if num_match:
        num = num_match.group(1)
        content_start = num_match.end()
        # 从 content_start 提取标题
        rest = stext[content_start:]
        # 尝试：找到第一个 "。" 或第二个 "数字." 之前的内容
        next_chapter = re.search(r'(。|[\s,，]\d{1,2}\.\s|[\s,，]\d{1,2}\.\d{1,2}\s)', rest)
        if next_chapter:
            title_candidate = rest[:next_chapter.start()].strip()
        else:
            # 找前 20 字
            title_candidate = rest[:20].strip()
        # 如果标题太长，只取第一部分
        title_candidate = re.sub(r'\s+', ' ', title_candidate)
        if len(title_candidate) > 20:
            title_candidate = title_candidate[:20]
        sec_title = num + '. ' + title_candidate
        body_lines.append('      <div class="section-marker on-scroll">' + str(si+1).zfill(2) + ' · ' + sec_title + '</div>')
        body_lines.append('      <h2 class="on-scroll">' + sec_title + '</h2>')

    # 处理章节内容
    content = stext[content_start:].strip() if content_start else stext.strip()

    # 切分为小节
    sub_parts = []
    sub_starts = [0]
    for m2 in re.finditer(r'(^|[\s,，。；])(\d{1,2}\.\d{1,2})\s+([\u4e00-\u9fa5A-Za-z])', content):
        candidate = m2.group(2)
        # 排除版本号：如果前面有 "CUDA"、"驱动"、"vllm" 等关键词，或者是 x.0 x.5 等典型版本号
        window_start = max(0, m2.start()-40)
        before = content[window_start:m2.start()]
        # 如果候选标题紧邻前是中文，更可能是真正的小节
        before_clean = re.sub(r'\s+', '', before)
        if before_clean and not before_clean.endswith(('。', '，', ',', '；', '）', ')')):
            # 可能是嵌入在句子中的数字（如 "13.0 以上"），跳过
            continue
        sub_starts.append(m2.start())

    # 确保 sub_starts 排序和去重
    sub_starts = sorted(list(set(sub_starts)))

    if len(sub_starts) > 1:
        for j in range(len(sub_starts)):
            s = sub_starts[j]
            e = sub_starts[j+1] if j+1 < len(sub_starts) else len(content)
            sub_parts.append(content[s:e].strip())
    else:
        sub_parts = [content]

    for part in sub_parts:
        # 提取 h3 标题
        h3_match = re.match(r'(\d{1,2}\.\d{1,2})\s+([\u4e00-\u9fa5A-Za-z]+)', part)
        if h3_match:
            title = h3_match.group(1) + ' ' + h3_match.group(2)
            # 验证标题长度合理
            if 2 <= len(h3_match.group(2)) <= 20:
                body_lines.append('      <h3 class="on-scroll">' + title + '</h3>')
                part = part[h3_match.end():].strip()

        # 检查是否是代码块
        if re.search(r'(\$|curl\s|uv\s|python\s|--model|--tensor|nvidia-smi|from\s|import\s|snapshot_download|api_server)', part) and len(part) > 80:
            body_lines.append('      <div class="info-box info-box-jade on-scroll"><p style="font-family: var(--font-mono); font-size: 0.85rem; white-space: pre-wrap; word-break: break-all;">' + part + '</p></div>')
        elif len(part) > 400:
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
        elif part:
            body_lines.append('      <p class="on-scroll">' + part + '</p>')

content_html = '\n'.join(body_lines)
print('生成段落数:', len(body_lines))

# ===== 摘要 =====
summary = ''
for bl in body_lines:
    if 'section-marker' in bl or '<h2' in bl or '<h3' in bl or 'info-box' in bl:
        continue
    m2 = re.search(r'<p[^>]*>(.*?)</p>', bl)
    if m2:
        txt = m2.group(1)
        if len(txt) > 30 and '─' not in txt:  # 排除 ASCII 艺术
            summary = txt
            break
if not summary:
    summary = text[:160]
summary = summary.replace('\n', ' ')[:160]
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
