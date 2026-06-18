# Skill: 抖音搬运文章生成 (douyin-post-skill)

> 版本: 4.0
> 适用项目: expectopatronus00.github.io (纯静态 GitHub Pages 博客)
> 依赖: Node.js (>=18)，图标系统：内联 SVG
> 本 Skill 与 repo-lint-skill 配合使用，生成文章后脚本自动调用 repo-lint 校验

---

## 一、Skill 用途

**给我 N 条抖音视频信息，输出 N 篇结构完整、可部署的博客文章，并自动更新文章库和首页。**

本 Skill 用于将抖音视频转化为图文并茂的深度文章，自动融入 EXPECTOPATRONUS 博客的整体视觉体系。核心能力：

- **批量生成**: 一次输入多条视频，一次生成多篇文章
- **自动更新索引页**: 自动更新 home.html（articles 数组 + 统计数字）和 index.html（latest-grid + hero 数字）
- **分类 / 标签自动同步**: 新增文章的 `category` 和 `tags` 字段会自动出现在 home.html 的主题按钮和标签云中，**无需任何手工维护**
- **自动自检**: 生成完成后自动调用 `repo-lint.cjs --fix` 做一致性检查并修复显示数字
- **零手工操作**: 一条命令搞定生成 + 更新 + 自检

---

## 二、批量模式（推荐）

### 2.1 使用流程

```
用户输入多条视频信息
        ↓
  整理为 videos.json (格式见下方)
        ↓
node skills/douyin-post-skill/generate.js videos.json
        ↓
自动生成文章 + 更新 home.html + 更新 index.html
        ↓
git add -A && git commit && git push
```

### 2.2 videos.json 格式

每条视频一个对象，完整字段如下（可参考 `batch-template.json`）：

```json
[
  {
    "id": "dy-7651234567890123456",
    "title": "文章主标题",
    "eyebrow": "分类标签 · 如 AI 编程",
    "author": "抖音作者名",
    "date": "2026-06-17",
    "cover": "https://images.unsplash.com/xxx",
    "tags": ["标签1", "标签2", "标签3"],
    "summary": "一句话摘要，80~120字，用于文章库和首页卡片显示",
    "meta_desc": "SEO meta description，150字内",
    "meta_keywords": "SEO 关键词，逗号分隔，10~15个",
    "duration": "约 5 分钟阅读",
    "content_html": [
      "<div class=\"section-marker\">01 · 章节标题</div>",
      "<h2>章节标题</h2>",
      "<p>段落内容...关键术语用<span class=\"hl\">高亮</span></p>",
      "<div class=\"timeline\"><div class=\"tl-item\"><div class=\"tl-time\">时间</div><div class=\"tl-text\">描述</div></div></div>",
      "<div class=\"pull-quote\"><p>引用内容</p></div>",
      "<div class=\"info-box\">信息提示框</div>"
    ],
    "cta": {
      "title": "去抖音看原视频",
      "desc": "点击跳转抖音原视频页",
      "url": "https://www.douyin.com/video/7651234567890123456"
    },
    "platforms": [
      {
        "name": "抖音",
        "icon": "<svg class=\"icon icon-sm\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3v10.5a3.5 3.5 0 1 1-2-3.16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M14 3v8.5M14 3h4.5M14 8.5h4.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
        "url": "https://www.douyin.com/video/...",
        "desc": "视频原页"
      },
      {
        "name": "GitHub",
        "icon": "<svg class=\"icon icon-sm\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.48l-.01-1.7c-2.78.62-3.37-1.36-3.37-1.36-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.29.1-2.69 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 7.07c.85 0 1.7.12 2.5.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.4.2 2.43.1 2.69.64.72 1.03 1.64 1.03 2.76 0 3.94-2.35 4.8-4.58 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.58.69.48A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2z\"/></svg>",
        "url": "https://github.com/...",
        "desc": "相关代码"
      }
    ],
    "footer_meta": "本站内容纯学习用途，非商用。视频封面版权归抖音原视频作者所有。"
  }
]
```

**必需字段**: `id`, `title`, `author`, `date`, `cover`, `tags`, `summary`, `content_html`, `cta.url`
**可选字段**: `eyebrow`（默认用 title）, `meta_desc`（默认用 summary）, `meta_keywords`（默认用 tags）, `duration`（默认"约 5 分钟阅读"）, `footer_meta`（有默认值）, `platforms`（可选）

**常用 SVG 图标库**（`icon` 字段可直接使用下列完整 SVG 字符串）：

| 用途 | SVG |
|---|---|
| 抖音（音符） | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.5a3.5 3.5 0 1 1-2-3.16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 3v8.5M14 3h4.5M14 8.5h4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` |
| GitHub | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.48l-.01-1.7c-2.78.62-3.37-1.36-3.37-1.36-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.29.1-2.69 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 7.07c.85 0 1.7.12 2.5.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.4.2 2.43.1 2.69.64.72 1.03 1.64 1.03 2.76 0 3.94-2.35 4.8-4.58 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.58.69.48A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></svg>` |
| 机器人 | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 5v3M9 8V6M15 8V6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 大脑 | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5C6.5 5 5 7 5 9.5 5 11.5 6 13 5.5 14.5 5 16 6.5 17.5 9 17.5c.5 0 1 0 1.5-.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M15 5c2.5 0 4 2 4 4.5 0 2-1 3.5-.5 5 .5 1.5-1.5 3-4 3-.5 0-1 0-1.5-.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11.5 5h1M11.5 8.5h1M11.5 12h1M11.5 15.5h1M11.5 17.2h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 笑脸 | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10.5" r="0.8" fill="currentColor"/><circle cx="15" cy="10.5" r="0.8" fill="currentColor"/><path d="M8.5 14.5c1 1.5 2.2 2.5 3.5 2.5s2.5-1 3.5-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 微芯片 | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="4" height="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3M9 4v3M12 4v3M15 4v3M9 17v3M12 17v3M15 17v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 图书馆立柱 | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V7c0-1.5 1-2 3-2s3 .5 3 2v14M11 21V7c0-1.5 1-2 3-2s3 .5 3 2v14M3 21h18M4 5l16 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| Chart-line | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 20V14M10 20V8M15 20V12M20 20V5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |

### 2.3 执行命令

```bash
cd /workspace
node skills/douyin-post-skill/generate.js path/to/videos.json
```

脚本会自动：

1. 读取 template.html，为每条视频生成独立的文章 HTML，写入 `post/dy-{ID}/dy-{ID}.html`
2. 更新 `home/home.html`:
   - "共 N 篇" → N + 新增数量
   - 在 `var articles = [` 数组最前面插入新文章对象
3. 更新 `index.html`:
   - 第一个 `class="num"`（articles 数字）+ 新增数量
   - 在 `<div class="latest-grid">` 最前面插入新文章卡片

### 2.4 content_html 可用组件

| 组件 | 写法 |
|---|---|
| 章节编号+标题 | `<div class="section-marker">01 · 标题</div><h2>章节标题</h2>` |
| 关键词高亮 | `<span class="hl">术语</span>` |
| 时间线 | `<div class="timeline"><div class="tl-item"><div class="tl-time">时间</div><div class="tl-text">描述</div></div></div>` |
| 引用块 | `<div class="pull-quote"><p>引用文字</p></div>` |
| 信息框 | `<div class="info-box">提示内容</div>` |
| 青色信息框 | `<div class="info-box info-box-jade">内容</div>` |

### 2.5 内容要求

- **原创重述**: 不要复制视频逐字稿，用自己的话重述
- **每篇 5~8 个章节**: 每章至少 2 段正文或 1 个特殊组件
- **关键词高亮**: 重要术语用 `<span class="hl">`
- **敏感内容**: 不输出涉政、医疗、投资建议等内容

---

## 三、单篇模式 · 用户输入格式

用户会给出类似这样的消息片段：

```
7.10 复制打开抖音，看看【XXX的作品】标题文字...
https://v.douyin.com/xxxxxxx/
2026-06-16 8:00pm WMJ:/ g@B.TY
内容文章合并，并实现多平台链接形成文章内容
```

**必须从输入中提取的关键信息：**

| 字段         | 说明                                          | 示例                                        |
| ------------ | --------------------------------------------- | ------------------------------------------- |
| `VIDEO_URL`  | 抖音短链，或已展开的 `douyin.com/video/` 链接 | `https://v.douyin.com/iLabcdef/`            |
| `AUTHOR`     | 作者昵称（"【】" 内的内容）                   | `AI风向标`                                  |
| `TITLE`      | 视频标题 / 作品标题                           | `顶级AI模型遭封禁，Anthropic硬刚美国监管！` |
| `DATE_TODAY` | 今日日期，作为发布日期                        | `2026-06-16`                                |

**如果链接需要展开，用浏览器访问短链，从地址栏获取最终的 `https://www.douyin.com/video/{VIDEO_ID}` 形式。**

`VIDEO_ID` = URL 中 `/video/` 后的数字（如 `7651945427952078131`）。

---

## 四、单篇模式 · 操作流程（Agent 必须严格按此顺序执行）

### 阶段 1: 信息采集（浏览器工具）

1. **锁定浏览器**后访问 `VIDEO_URL`
2. 等待页面完全加载（抖音会重定向 1~2 次）
3. 从页面提取：
   - **封面图 URL**：页面中的 `<img>` 或 `og:image`（通常为 `p*-pc-sign.douyinpic.com/...` 链接）
   - **最终视频页 URL**：`https://www.douyin.com/video/{VIDEO_ID}`
   - **作者名**：页面上的作者展示区名称
   - **视频标题**：页面标题或 hero 区大标题
4. **解锁浏览器**

### 阶段 2: 内容创作（直接撰写）

**根据视频主题，创作 5~8 个章节的深度内容：**

#### 2.1 结构模板（固定，所有文章均采用此结构）

```
[英雄区] 封面 + 分类tag + 大标题 + 作者/日期/时长/分类 4 个元信息
[简介 block] 150~200 字，讲清"这篇文章讲什么、最有冲击力的一句话是什么"
[正文] 5~8 个二级章节 (h2)，其中穿插：
   ├── 时间线卡片 (timeline) - 适合事件型/发展史主题
   ├── 引用 block (pull-quote) - 适合名人言论/核心观点/争议焦点
   ├── 三级小标题 (h3) - 二级章节内的细分点
[CTA 区] 封面缩略图 + 「去抖音看完整视频」按钮 + 「官方站」按钮
[多平台卡片] 6~10 个相关平台（见下方表）
[话题标签] 8~12 个 #标签
[相关文章] 2 个链接，指向 home.html 或站内已有文章
```

#### 2.2 多平台卡片推荐库（根据文章主题挑选 8 个左右）

所有卡片使用内联 SVG 图标，无需外部图标字体。直接将下列 SVG 字符串嵌入 `platform-list` 中 `<a>` 的开头位置即可。

| 领域        | 平台/链接        | 内联 SVG |
| ----------- | ---------------- | -------- |
| 通用        | 抖音原视频       | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.5a3.5 3.5 0 1 1-2-3.16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 3v8.5M14 3h4.5M14 8.5h4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` |
| AI / 大模型 | Anthropic        | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 5v3M9 8V6M15 8V6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| AI / 大模型 | DeepSeek         | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5C6.5 5 5 7 5 9.5 5 11.5 6 13 5.5 14.5 5 16 6.5 17.5 9 17.5c.5 0 1 0 1.5-.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M15 5c2.5 0 4 2 4 4.5 0 2-1 3.5-.5 5 .5 1.5-1.5 3-4 3-.5 0-1 0-1.5-.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11.5 5h1M11.5 8.5h1M11.5 12h1M11.5 15.5h1M11.5 17.2h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| AI / 开源   | GitHub           | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.48l-.01-1.7c-2.78.62-3.37-1.36-3.37-1.36-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.29.1-2.69 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 7.07c.85 0 1.7.12 2.5.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.4.2 2.43.1 2.69.64.72 1.03 1.64 1.03 2.76 0 3.94-2.35 4.8-4.58 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.58.69.48A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></svg>` |
| AI / 论文   | arXiv            | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V7c0-1.5 1-2 3-2s3 .5 3 2v14M11 21V7c0-1.5 1-2 3-2s3 .5 3 2v14M3 21h18M4 5l16 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 科技公司    | 英伟达           | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="4" height="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3M9 4v3M12 4v3M15 4v3M9 17v3M12 17v3M15 17v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 政府监管    | 美国商务部       | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V7c0-1.5 1-2 3-2s3 .5 3 2v14M11 21V7c0-1.5 1-2 3-2s3 .5 3 2v14M3 21h18M4 5l16 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 讨论        | X / Twitter      | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l8 11M20 4l-8 11M8 20h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |
| 财经        | 相关上市公司官网 | `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 20V14M10 20V8M15 20V12M20 20V5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` |

**卡片格式**（直接作为 `CONTENT_HTML` 的一项写入）：

```html
<div class="platform-list">
  <a href="https://www.douyin.com/video/..." target="_blank" rel="noopener">
    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.5a3.5 3.5 0 1 1-2-3.16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 3v8.5M14 3h4.5M14 8.5h4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    抖音 · 视频原页
  </a>
  <a href="https://github.com/..." target="_blank" rel="noopener">
    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.48l-.01-1.7c-2.78.62-3.37-1.36-3.37-1.36-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.29.1-2.69 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 7.07c.85 0 1.7.12 2.5.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.4.2 2.43.1 2.69.64.72 1.03 1.64 1.03 2.76 0 3.94-2.35 4.8-4.58 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.58.69.48A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></svg>
    GitHub · 相关代码
  </a>
</div>
```

#### 2.3 正文字数与风格要求

- 全文 **800~1500 字**
- 段落清晰，每段不超过 4 行
- 每个 h2 章节下至少 2 段正文或 1 个时间线/引用 block
- 关键术语用 `<span class="hl">...</span>` 高亮
- 引用的重要事实、争议观点用 `<div class="pull-quote"><p>...</p></div>` 包裹
- 时间序列内容用 `<div class="timeline"><div class="tl-item">...</div></div>`

#### 2.4 内容安全

- **不输出任何需要付费的原文**：不得复制抖音作者的逐字稿
- **不输出视频中的完整字幕**：用自己的话重述
- **不输出敏感/涉政/医疗建议/投资建议**内容
- 文末 CTA 区要保留 `本站仅做学习归档，内容归原作者所有` 的提示

### 阶段 3: 生成文件

#### 3.1 新建文章目录

```
/workspace/post/dy-{VIDEO_ID}/
└── dy-{VIDEO_ID}.html
```

**注意：文章页面引用 `../../home/design-tokens.css` 共用设计令牌，页面私有样式内联在 `<style>` 中。不创建单独的 style.css 或 script.js。favicon 使用 `../../home/logo.svg`。**

#### 3.2 使用 `template.html` 填充内容

模板文件路径：`/workspace/skills/douyin-post-skill/template.html`

**模板结构说明：**

```
page-head      ← 顶部区域：eyebrow + h1（em标签斜体）+ 导语 + meta元信息
hero-image     ← 封面大图
article-body   ← 正文主体，h2/h3/p/blockquote/div 均内嵌其中
site-footer    ← 底部
```

**正文内嵌组件（直接写在 CONTENT_HTML 中）：**

| 组件 | HTML | 用途 |
|---|---|---|
| 章节编号 | `<div class="section-marker">01 · 标题</div><h2>章节标题</h2>` | 橙色 monospace 小标签 + 二级标题 |
| 关键词高亮 | `<span class="hl">术语</span>` | 正文内突出术语 |
| 信息框 | `<div class="info-box">…</div>` 或 `<div class="info-box info-box-jade">` | 左侧橙色/青色边线提示 |
| 时间线 | `<div class="timeline"><div class="tl-item"><div class="tl-time">时间</div><div class="tl-text">内容</div></div></div>` | 流程/事件列表 |
| 重点引用 | `<div class="pull-quote"><p>引用文字</p></div>` | 带左侧大引号的引用块 |
| 平台卡片 | `<div class="platform-list"><a href="…">SVG图标 · 名称 · 描述</a></div>` | 相关平台链接列表 |
| 标签行 | `<div class="tags-row"><a href="#">#标签</a></div>` | 底部话题标签 |
| CTA区 | `<div class="cta-box"><div class="cover"><img …/></div><div class="content"><h3>标题</h3><p>描述</p><a class="cta-btn" id="cta-link" href="…" …>按钮</a></div></div>` | 跳转按钮区，id="cta-link" 会被脚本劫持复制当前页 URL |

**需要替换的占位符：**

| 占位符 | 说明 |
|---|---|
| `{{EYEBROW}}` | 顶部斜体标签，如 "AI 工作模式 · Vibe Coding" |
| `{{TITLE}}` | 文章标题（含斜体 em 标签包裹关键词），如 "别人睡觉在休息，<em>高手睡觉在开发</em>" |
| `{{META_DESC}}` | meta description，150字以内 |
| `{{META_KEYWORDS}}` | 逗号分隔关键词，10~15个 |
| `{{OG_TITLE}}` | og:title，通常和 TITLE 一致 |
| `{{OG_DESC}}` | og:description，通常和 META_DESC 一致 |
| `{{AUTHOR}}` | 作者昵称 |
| `{{DATE_TODAY}}` | 日期 YYYY-MM-DD |
| `{{DURATION}}` | 视频时长估算，如 "1 分 24 秒" |
| `{{COVER_URL}}` | 封面图完整 URL |
| `{{SUMMARY_HTML}}` | 导语段落，纯文本（模板内已有 p 标签包裹） |
| `{{CONTENT_HTML}}` | 正文所有 HTML（section-marker / h2 / h3 / p / timeline / pull-quote 等） |
| `{{FOOTER_META}}` | 页脚说明，默认 "本站内容纯学习用途，非商用。视频封面版权归抖音原视频作者所有。" |

### 阶段 4-5-6: 自动更新（无需手工操作）

脚本 `generate.js` 会自动完成以下所有步骤：

**home.html**
- 解析 `var articles = [...]` 数组，在**最前面**插入新文章对象
- 解析 "共 N 篇" 文字，N 自动 `+ 新增篇数`

**index.html**
- 解析 `<div class="num">N</div>`（articles 数字）自动 `+ 新增篇数`
- 在 `<div class="latest-grid">` **最前面**追加新卡片

**分类 & 标签（关键）**
- 分类按钮 (`#cat-bar`) 和 标签云 (`#tag-pills`) 均由 home.html 在页面加载时**从 articles 数组动态提取和渲染**
- 也就是说：**只要 articles 数组里的 `category` 和 `tags` 字段正确，主题按钮和标签云就会自动出现新项**
- 不再需要手工修改分类按钮或标签云 HTML

**自动自检**
- 脚本运行结束后会自动执行 `node scripts/repo-lint.cjs --fix`
- 如果存在文章数与显示数字不一致的问题，脚本自动修正并输出 `✅`
- 如存在死链 / 重复 / 孤链 等结构性问题，脚本会输出 `⚠️` 并提示手动修复

**必须做以下验证才能算完成：**

1. **代码检查**: `cd /workspace && node scripts/repo-lint.cjs`，输出必须 `✅ 全部通过`，不允许出现任何 `❌` 项
2. **浏览器验证**: 用浏览器工具打开 `file:///workspace/post/dy-{VIDEO_ID}/dy-{VIDEO_ID}.html`，确认：
   - 封面图正常加载（抖音图片外链通常可访问）
   - SVG 图标正常显示，主题切换按钮月亮/太阳可交互
   - CTA 按钮点击能正常打开抖音原页
   - 多平台卡片能正常跳转
3. **文章库验证**: 访问 home.html，检查新文章卡片显示、"共 N 篇" 数字正确
4. **首页验证**: 访问 index.html，检查 latest-grid 中新加卡片正常，hero-stats 第一个数字正确

### 阶段 7: Git 推送

```bash
cd /workspace
git add -A
git commit -m "feat: 新增抖音搬运文章 - {{TITLE}}"
git push origin main
```

---

## 五、样式参考

所有视觉参数定义于 `../../home/design-tokens.css` 中，**不要在文章页面重复定义 CSS 变量**，以保持全站一致。

**共用 design tokens（只读）：**

| 变量 | 用途 |
|---|---|
| `--bg-card` | 卡片背景 |
| `--text` | 主文字色 |
| `--text-soft` | 次要文字色 |
| `--text-dim` | 暗淡文字色 |
| `--accent-rust` | 强调色（橙褐色），用于标题/链接/图标 |
| `--accent-jade` | 次强调色（青绿色），用于 info-box-jade / 备用按钮 |
| `--line` | 分割线颜色 |
| `--shadow-md` | 中等阴影 |
| `--r-lg` | 大圆角 |
| `--r-xl` | 特大圆角 |
| `--r-md` | 中等圆角 |
| `--sp-3` ~ `--sp-10` | 间距阶梯 |
| `--font-display` / `--font-serif` / `--font-mono` | 字体栈 |

**正文内嵌组件对应 class（请勿更改）：**

- `.section-marker` / `.article-body h2` / `.article-body h3`
- `.hl`（关键词高亮，基于 `--accent-rust`）
- `.info-box` / `.info-box-jade`
- `.timeline` / `.tl-item` / `.tl-time` / `.tl-text`
- `.pull-quote`
- `.platform-list`
- `.tags-row`
- `.cta-box` / `.cta-btn`

响应式断点：`max-width: 820px` / `max-width: 480px`

---

## 六、已有文章参考（Agent 可用来校准风格）

| 路径 | 主题 | 风格 |
|---|---|---|
| `/workspace/post/dy-7649321749746476261/dy-7649321749746476261.html` | AI 五大王牌工作模式 | 模式解析型 |
| `/workspace/post/dy-7651945427952078131/dy-7651945427952078131.html` | Anthropic 封禁事件 | 深度分析型 |
| `/workspace/post/dy-7646747643204900836/dy-7646747643204900836.html` | Harness starter 开源 | 工具介绍型 |
| `/workspace/post/dy-7641962519699017001/dy-7641962519699017001.html` | Gemini × Composer 踢馆赛 | 事件对比型 |

---

## 七、常见问题

**Q: 抖音封面图加载失败怎么办？**
A: 抖音的图片链接带 `x-expires` 和 `x-signature`，有过期时间。如果发现 403，直接用抖音打开视频，重新提取封面；或者用 `https://images.unsplash.com/...` 同主题的免费图片替代。

**Q: 视频有作者水印，需要保留吗？**
A: 封面自带的水印是作者信息，属于作者内容的一部分，保留即可。正文 CTA 区已声明"内容归原作者所有"。

**Q: articles 数组的格式需要严格一致吗？**
A: 是的，严格参照 home.html 中已有项的格式：使用单引号 `'`，key 不加引号（如 `id:` 而非 `"id":`），逗号分隔，缩进 2 空格。

**Q: 日期填什么？**
A: 一律用用户消息里的日期（或当天日期），格式 `YYYY-MM-DD`。首页卡片的 date 字段使用 `YYYY · MM · DD HH:mm` 格式。

**Q: repo-lint 检查不通过怎么办？**
A: 根据 `node scripts/repo-lint.cjs` 输出的 `❌` 项逐一修复。常见问题包括：HTML 标签未闭合、SVG 属性缺失 `aria-hidden`、文章路径不存在、home.html articles 数字与实际文章数不一致等。

---

## 八、自检清单（每次调用前过一遍）

- [ ] 提取了 VIDEO_ID、AUTHOR、TITLE、封面 URL
- [ ] 文章内容是原创重述，不是逐字复制
- [ ] 生成了 dy-{VIDEO_ID}/dy-{VIDEO_ID}.html
- [ ] 更新了 home.html 的 articles 数组和 "共 N 篇" 数字
- [ ] 更新了 index.html 的 hero-stats 数字和 latest-grid 卡片
- [ ] 已运行 `node scripts/repo-lint.cjs`，无 ❌ 项
- [ ] 浏览器打开验证通过（SVG 图标、主题切换均正常）
- [ ] 已 git push
