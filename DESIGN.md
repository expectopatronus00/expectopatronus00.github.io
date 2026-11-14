---
version: 1.3
name: EXPECTOPATRONUS Blog Design System
description: 中文 AI 工具学习归档站的设计系统。编辑室 × 技术实验室，暗色为默认、暖纸为浅色，字体主导、网格规整、留白克制，配色只做收敛。供 AI 编码 Agent 在生成页面或改样式前阅读。
source_of_truth: home/design-tokens.css
scope: 全站（首页 index.html / 归档 home / 导航站 nav / 全部文章页 post）
updated: 2026-11-14
---

# DESIGN.md · EXPECTOPATRONUS

> 这份文件只回答「站点应该长什么样」。`README.md` 回答「站点是什么」，`skills/daily-writer/SKILL.md` 回答「文章怎么写」。
>
> **所有数值均取自线上实际 CSS。改样式时先改 `home/design-tokens.css`，再同步本文件；两者不一致时以 CSS 为准，并把文档修回来。**

---

## 0. 源文件地图与加载顺序（改动前必读）

| 文件 | 职责 | 影响范围 |
| --- | --- | --- |
| `home/fonts.css` | 字体声明（拉丁自托管 woff2）；**中文 CDN 分片 CSS 不在这里 `@import`**，见下方加载顺序 | 全站 |
| `home/design-tokens.css` | **唯一共享视觉规范**：token、reset、共享组件、响应式、精修层、`a.skip-link` 无障碍样式 | 全站所有 HTML |
| `home/theme-color.js` | 按 `data-theme` 同步 `meta[name=theme-color]`，颜色读 `--bg`，不在 JS 里另写色值 | 全站所有 HTML |
| `scripts/head-hints.cjs` | head 提示层唯一实现（`theme-color` / CDN `preconnect` / **并行 emfont 样式表** / 同步脚本），产出包在 `<!-- head-hints:begin … end -->` | 全站所有 HTML |
| `scripts/skip-link.cjs` | 「跳到主要内容」唯一实现，产出 `<!-- skip-link:begin … end -->` + 主内容锚点属性 | 全站所有 HTML |
| `post/article-common.css` / `post/_shared/<hash>.css` | 从重复内联样式抽出的共享 CSS，按内容哈希去重，由 `scripts/apply-shared-css.cjs` 管理 | 文章页 |
| 各页内联 `<style>` | 页面专属结构（hero、归档列表、导航卡片…） | 单页 |
| `post/article-read.css` | 文章易读性层（正文排版、章节呼吸、列表/表格、封面 picture、移动端目录） | 全部文章页 |
| `post/article.js` | 运行时注入：进度条、侧边/移动端目录、上下篇、相关文章、超长核对框折叠 | 文章页 |
| `scripts/build-article.cjs` | 新文章 HTML 渲染（SEO / head hints / skip-link / `article-read.css` / 封面 jpg+webp / 首页静态兜底同步） | 新稿 |
| `scripts/seo-meta.cjs` + `site-meta.cjs` | 页级 SEO 唯一实现与静态页白名单（5 个可索引页；404 与跳转页保持 `noindex`） | 全站所有 HTML |

**加载顺序**：`<meta charset>` → **head hints 块**（`theme-color` / `preconnect` / `dns-prefetch` / **emfont CSS 外链** / `theme-color.js`）→ `fonts.css` → `design-tokens.css` → 页面内联 `<style>` 或它的等价格 `<link data-shared-css>` → `article-read.css`（由 `scripts/apply-read-css.cjs` 插在 `</head>` 前）。共享 CSS 是**原位替换**内联 `<style>`，内容与层叠顺序都不变，所以视觉零回归。hints 必须排在所有 CSS 之前，`preconnect` 才能在网络请求发出前建好连接；`theme-color.js` 用 `defer`，等 CSS 就位后再读 `--bg`。

**字体并行**：中文霞鹜新致宋的 CSS 曾是 `fonts.css` 顶部的 `@import`，浏览器必须先下载并解析完 `fonts.css` 才发起这个跨域请求，实测有约 310 ms 串行空档。现在由 `head-hints.cjs` 在 hints 块里输出 `<link rel="stylesheet" href="https://font.emtech.cc/css/LXGWNeoZhiSong/400">`，与 `fonts.css` 并行（实测发起时差 −1 ms，`load` 720 → 420 ms）。只有真正引用 `home/fonts.css` 的 165 页才带这条 link；`nav/stars/index.html` 这类不加载字体的跳转页不带。

四条由此产生的硬约束：

1. `design-tokens.css` 在页面内联样式**之前**加载，同名规则会被页面级回收。因此精修层的覆盖规则统一写 `html body .xxx` 提升特异性（见该文件 `EDITORIAL REFINEMENT` 区块）。**新增全站规则一律沿用 `html body` 前缀。**
2. `article-read.css` 在内联样式**之后**加载，同特异性下自然生效，**不需要 `!important`**；改呈现层只动这一个共享文件，不逐篇改文章 HTML。
3. 新增通用组件样式请**追加到 `design-tokens.css`**；文章级共享规则追加到 `post/article-read.css`。不要新建全站 CSS 文件、不要给文章页逐个加内联样式。
4. `post/article-common.css` 与 `post/_shared/` 是**生成物**，由 `apply-shared-css.cjs` 按内容哈希产出，不要手改；`repo-lint.cjs` 会校验每个 `data-shared-css` link 指向的文件存在且哈希一致。
5. head hints 块是**生成物**，由 `scripts/apply-head-hints.cjs` 幂等注入，不要手改任何页面的 `<meta name="theme-color">`。静态默认值取自 `design-tokens.css` 的 `--ink-950`（深色）/`--paper`（浅色）；**改了这两个 token 后必须跑一次 `node scripts/apply-head-hints.cjs`**，否则 `repo-lint` 的「theme-color 与 CSS 一致」会失败。
6. **不要往 `home/fonts.css` 加回 `@import`**：lint 会剥掉注释后检测真实规则并判失败。中文分片 CSS 的唯一出口是 `scripts/head-hints.cjs` 的 `FONT_CSS` 常量。
7. `<!-- seo:begin -->` / `<!-- skip-link:begin -->` / `<!-- head-hints:begin -->` / `<!-- static:* -->` 全是**生成物**，不要手改页内标签。新增这类层必须同时接三个入口：唯一实现 `.cjs` → `build-article.cjs` 渲染时直接注入（新稿不等收尾）→ `build-index.cjs` 的 `syncSteps` 数组（存量幂等补齐）→ `repo-lint.cjs` 覆盖率断言。
8. `build-article.cjs` 定位模板切点只匹配标签**前缀** `<section class="page-head"`，不要带结尾 `>`：注入类脚本会给这个标签追加 `id` / `tabindex` / 图片属性，整串匹配会突然失效并让所有新稿渲染停摆（P3 实测踩过）。
9. skip-link 必须是**纯 HTML**（禁用 JS 时仍可用），且不能用 `display:none` / `visibility:hidden` 隐藏——那样键盘聚焦不到。用 `transform` 移出视口、`:focus` 滑回来，样式同样带 `html body` 前缀。

**主题机制**：`<html>` 上用 `data-theme="dark" | "light"` 切换，偏好存 `localStorage.theme`，默认 `dark`，只有值为 `light` 时才写入属性。首页与归档页 HTML 硬编码 `data-theme="dark"`，文章页由 `<head>` 内联脚本读取后设置。所有颜色必须走语义变量，才能双主题自动生效。浏览器地址栏配色不由系统配色决定：静态给深色兜底，`home/theme-color.js` 用 `MutationObserver` 监听 `data-theme`、用 `storage` 事件跨标签同步，每次都从 `--bg` 读当前色值。

---

## 1. Visual Theme & Atmosphere

**编辑室 × 技术实验室**：像一份可以长期阅读的技术刊物，不是产品落地页。

- 方向是 Editorial：字体主导、网格规整、克制留白。排版 + 间距决定约 65% 的观感，配色只负责收敛与点睛。
- 深底（默认）用冷蓝黑 `#0b0d16` 配温暖的白纸色文字 `#ede9df`；浅底用暖纸 `#f4efe4` 配深墨 `#2a2518`。两种主题都是「暖字/冷底」的对照关系。
- 氛围层极轻：`body::before` 两处 radial-gradient（锈橙 7% / 翡翠 5%），`body::after` 一层 3.5% 的 SVG 噪点，`pointer-events: none`。
- 情绪关键词：安静、可核对、有出处、不催促。**不要**渐变按钮墙、玻璃拟态、霓虹发光、大面积纯黑营销区块、自动轮播。
- 中文长文优先：段落宽度、行高、章节边界比装饰更重要；动效一律克制（`--dur-fast: 0.18s` 起）。

---

## 2. Color Palette & Roles

### Ink scale（深色模式）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ink-950` | `#0b0d16` | 页面背景 |
| `--ink-900` | `#12151f` | 卡片背景 / 表头 |
| `--ink-800` | `#1a1d2e` | 子卡背景 |
| `--ink-700` | `#2a2e44` | 分隔线 / 边框 / 滚动条 |
| `--ink-600` | `#3a3f58` | hover 边框 |
| `--ink-500` | `#5a5e7a` | **仅装饰，禁止用于文字**（深底 3.06:1） |
| `--ink-300` | `#8a8ea8` | 元信息 / 标签 / `--text-dim`（6.01:1 / 卡片 5.17:1） |
| `--ink-150` | `#b8bcd0` | 辅助正文 |
| `--ink-50` | `#ede9df` | 主文本 · 温暖的白纸色 |

### Warm paper（浅色模式）

`--paper: #f4efe4`（背景）、`--paper-soft: #ebe5d4`（区块）、`--paper-line: #cdc3a8`（分隔线）、`--paper-ink: #2a2518`（主文本）、`--paper-muted: #6a6250`（说明文本）。

### Accent —— 装饰色与文字色必须分开

| Token | 深色值 | 用途 |
| --- | --- | --- |
| `--accent-rust` | `#b8581d` | 赭橙 · 边框/色块/图标（深底仅 4.11:1） |
| `--accent-rust-soft` | `#d9834a` | 柔和版 |
| `--accent-rust-text` | `#d4692a` | **文字专用** · 深底 5.4:1 / 卡片 4.65:1 |
| `--accent-jade` | `#2f7d5d` | 翡翠绿 · 装饰（3.89:1） |
| `--accent-jade-text` | `#4a9e7f` | **文字专用** · 深底 5.99:1 / 卡片 5.15:1 |
| `--accent-ink` | `#161821` | 最深标题 |
| `--accent-gold` | `#b8915c` | 金色 · 装饰 / 进度条末端 |

浅色模式重映射：`--accent-rust-text: #a34d18`（5.04:1）、`--accent-jade-text: #256b4e`；`--text-soft: #4a4135`；`--bg-card` 最终为 `#fffdf8`（精修层覆盖基础层的 `#ffffff`，让卡片融进暖纸底而非浮起）。

### 语义变量（写样式只用这一层）

```
--bg / --bg-soft / --bg-card     表面三级
--line / --line-soft             分隔线（soft 为 8% 透明度）
--text / --text-soft / --text-dim 文本三级
--accent / --accent-2            装饰色
--ring                           焦点环 = --accent-rust-text
--measure: 46rem                 摘要/说明文字最大行宽
```

`::selection` 用 `rgba(184, 88, 29, 0.3)`；链接 hover 统一变 `--accent-rust-text`。

**当前缺口（不要凭空发明）**：站点还没有 `success / warning / error / primary-disabled` 语义状态色，也没有浅色版 `--paper-line-soft`。需要时用现有变量组合，或按上面「装饰/文字分离」的方式新增并注明两套主题的对比度实测值。

---

## 3. Typography Rules

### 四条字体栈（不要改，不要新增网络字体）

| 变量 | 栈 | 用途 |
| --- | --- | --- |
| `--font-display` | `Cormorant Garamond`, `LXGWNeoZhiSong`, `Source Han Serif SC`, georgia, `Songti SC`, serif | 标题 / 品牌 / 引语 |
| `--font-serif` | `Source Serif 4`, `LXGWNeoZhiSong`, `Source Han Serif SC`, georgia, `Songti SC`, serif | 正文阅读 |
| `--font-sans` | 系统栈（`-apple-system` → `PingFang SC` → `Microsoft YaHei`） | 导航 / UI |
| `--font-mono` | `SF Mono`, `JetBrains Mono`, Menlo, Consolas, `Courier New`, monospace | 代码 / 标签 / 元信息 |

Cormorant Garamond 默认输出旧式数字（2 下沉、看起来像 1），所以 `.text-display` 强制 `font-variant-numeric: lining-nums` + `font-feature-settings: 'lnum' 1`。**凡是显示统计数字的标题都要带 `.text-display`。**

### 字号与行高

`--fs-xs .72` / `--fs-sm .85` / `--fs-base 1` / `--fs-lg 1.12` / `--fs-xl 1.35` / `--fs-2xl 1.7` / `--fs-3xl 2.2` / `--fs-4xl 3` / `--fs-5xl 4.2` rem；行高 `--lh-tight 1.15` / `--lh-snug 1.35` / `--lh-normal 1.75` / `--lh-loose 1.95`。根字号 16px。

| 场景 | 规则 |
| --- | --- |
| 文章页 h1 | `clamp(2rem, 4.5vw, 3.2rem)` / 1.12 / `-0.02em` / `--font-display` 500 |
| 首页 hero | 精修层 1.14 / `-0.022em`；`.line-2` 1.24；手机 1.18 |
| 正文 h2 / h3 | `clamp(1.5rem, 2.2vw, 1.85rem)` / 1.25 与 1.25rem / 1.3 |
| 正文段落 | 基础层 1rem / 1.9；**易读性层最终生效值 `1.075rem`（≈17.2px）/ 1.95** / 字距 `0.012em` / 段距 `1.35em` / `text-wrap: pretty` |
| 导语 | `1.075rem` / 1.85 / `max-width: 46em` |
| 元信息 / eyebrow | `--font-mono`，`0.7–0.82rem`，字距 `0.12–0.18em`，大写 |

中文长文最大行宽：`.article-body` 为 `--container-narrow: 780px`；摘要与卡片说明受 `--measure: 46rem` 限制，避免一行超过约 60 个汉字。

---

## 4. Component Stylings

统一状态语言：hover 时文字/边框转 `--accent-rust-text` / `--accent-rust`，配 `translateY(-2px ~ -4px)` 或 `translateX(4px)`，过渡用 `var(--dur-fast)`；卡片 hover 另加 `transform: translateY(-3px)`；`:focus-visible` 一律 2px `--ring` 焦点环 + `outline-offset: 3px`。

| 组件 | 类名 | 关键样式 |
| --- | --- | --- |
| 顶栏 | `.site-nav` / `.nav-inner` / `.brand` / `.nav-links` | sticky `--nav-height: 72px`，`rgba(11,13,22,.72)` + `blur(16px)`；浅色 `rgba(244,239,228,.82)`；`.is-active` 下方 1.5px 锈色线 |
| 主题/菜单按钮 | `.theme-btn` / `.menu-toggle` | 40×40，1px 边框，`--r-md`；hover 旋转 -15° |
| 章节标签 | `.section-label` | mono 全大写 `0.18em`，前后各一条 28px / flex:1 细线 |
| 页面头 | `.page-head` | `--sp-10` 上留白，底部 1px 线；`.eyebrow` 锈色、`.meta-row` 虚线上边框 + mono |
| 信息框 | `.info-box` / `.jade` | 左侧 3px 锈色（jade 为翡翠），7–8% 同色底，右侧 `--r-lg` 圆角 |
| 数据表 | `.api-table` | 表头 mono 0.78rem 大写锈色 + `--bg-soft`；单元格 14px/18px；≤700px 改横向滚动 |
| 代码块 | `.code-block` | `#0a0a15` 底，`--r-lg`，`pre-wrap` + `overflow-wrap: anywhere`；`.kw/.cmd/.arg/.num/.cmt` 上色 |
| 标签 | `.tags-row a` | 999px 胶囊，mono 0.78rem，`--bg-soft` 底 |
| 章节分隔 / 引语 | `.section-divider` / `.pull-quote` | 细线夹 mono 标签 / 上下细线 + display 斜体 1.4rem 居中 |
| 时间轴 | `.timeline` / `.tl-item` | 2px 左边线 + 12px 锈色圆点，`box-shadow: 0 0 0 3px var(--bg)` 挖空 |
| 卡片组 | `.module-grid` / `.dim-card` / `.cmd-grid` / `.platform-list` | 3 列 / 2 列 / `auto-fit minmax(240px,1fr)`；`--bg-card` + 1px 边框 + `--r-lg` |
| 文章增强 | `.read-progress` / `.article-toc` / `.source-note` / `.merged-note` / `.prev-next` / `.related` | 由 `article.js` 运行时注入，HTML 不必手写；目录只在 ≥1240px 显示，当前项左侧 2px 锈色线 |
| 页脚 / 回顶 | `.site-footer` / `.floating-top` | `--sp-12` 上间距；回顶 46×46 圆形、fixed 右下 28px、`.visible` 才出现 |
| 封面双格式 | `.hero-image picture[data-cover-picture]` | `display:block` 消除匿名块盒；`img { height:auto }` 保住比例。`cover.webp` 给现代浏览器，`cover.jpg` 留给 fallback 与 `og:image` |
| CTA 单列变体 | `.cta-box[data-no-cover]` | 空封面清掉后从 `1fr 1.3fr` 收成 `1fr`，避免内容被挤进窄的第一列 |

**文章增强的两个运行时阈值**（`post/article.js`）：`.info-box` 正文 ≥280 字自动折成 `<details>`；`<1240px` 生成折叠章节目录。侧边目录只收正文 `h2`，**排除文末「相关平台」那个 h2**。

**图片的两条易错规则**：`<img>` 的 `width/height` 属性只是防 CLS 的比例提示，浏览器会当成 presentational hint；CSS 只写 `width:100%` 时不加 `height:auto` 会把封面压扁。站内不允许留 `src=""` 的占位图——没有脚本填充时它只会渲染成破图 + alt 文字，这类空 `.hero-image` 由 `scripts/apply-image-attrs.cjs` 整块清理。

---

## 5. Layout Principles

- **间距** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64 / 96 / 128 px（`--sp-1` … `--sp-12`），不用魔数。
- **圆角** `--r-sm 4` / `--r-md 8` / `--r-lg 14` / `--r-xl 22` px；胶囊用 `999px`。
- **容器** `--container: 1200px`（`.container` 左右 `--sp-6`）、`--container-narrow: 780px`（正文）、`--nav-height: 72px`（≤600px 变 62px）。
- **动效曲线** `--ease-out: cubic-bezier(.2,.8,.2,1)`；时长 0.18 / 0.35 / 0.65s。
- 留白哲学：章节之间靠 `--sp-9` 级间距 + 细分隔线建立边界，不靠色块堆叠；列表行距 `--sp-5`（20px，精修层从 16px 提上来）。
- `.container` / `.page-head` / `.article-body` 都设 `position: relative; z-index: 10`，必须浮在 `body::before/::after` 氛围层之上。

---

## 6. Depth & Elevation

阴影克制，卡片层级主要靠 **1px `--line` 边框 + `--bg` / `--bg-soft` / `--bg-card` 三级表面色**，不靠大投影。

```
--shadow-sm:   0 1px 2px rgba(0,0,0,.25)
--shadow-md:   0 8px 24px -8px rgba(0,0,0,.35)
--shadow-lg:   0 24px 48px -16px rgba(0,0,0,.55)
--shadow-glow-rust / --shadow-glow-jade: 1px 同色描边 + 柔和外发光
```

浅色模式把 `--shadow-md/lg` 换成 `rgba(13,15,26,.12/.15)`，glow 透明度降到 .2 左右。

z-index 层级：氛围层 `1`（渐变）/ `2`（噪点）→ 内容 `10` → 回顶 `50` → 顶栏 `100` → 阅读进度条 `200` → **`a.skip-link` 9999**（只在聚焦时可见，必须压过一切，不能被顶栏遮住）。新组件必须落在这套层级里。

---

## 7. Do's and Don'ts

### Do

- 所有颜色、间距、圆角、字体都写 `var(...)`；新 token 加在 `:root`，浅色覆写加在 `[data-theme='light']`。
- 装饰色和文字色分开用：`--accent-rust` 画边框，`--accent-rust-text` 写字，并注明两套主题下的对比度实测值。
- 全站级覆盖加 `html body` 前缀；文章阅读层改动加在 `post/article-read.css`。
- 新页面/新文章沿用现有 head 顺序与主题初始化脚本；新文章一律走 `node scripts/build-article.cjs --spec ...`。
- 交互元素保证 `:focus-visible`、≥44px 触摸目标；动效遵守 `prefers-reduced-motion`。
- 改完跑 `node scripts/repo-lint.cjs`，必须「全部通过」；新文章另跑 `node scripts/readability.cjs --file post/<id>/<id>.html`（≥75 才算完成）。

### Don't

- 不要 `!important`；不要硬编码 `#fff` / `#000` / 任意 px 间距。
- 不要改字体栈、不要引入新字体或前端框架/构建工具、不要整站换皮。
- 不要逐篇改文章页的内联 `<style>`；不要新建第二个全站 CSS 文件。
- 不要用 `--ink-500`（3.06:1）或 `--accent-rust`（4.11:1）当文字色；不要用 `--accent-*` 装饰色做小字。
- 不要把 `.article-body` 行高压到 1.5 以下、把正文行宽放到 780px 以上；不要为「更现代」加渐变按钮、霓虹或大幅阴影。
- 不要绕过 `repo-lint` 提交；不要改 `nav/stars/data.json` / `rank.json`（由每日快照任务维护）。
- 不要把本文件当成可随意改的提案：它是已生效样式的描述，改文档不等于改样式。

---

## 8. Responsive Behavior

| 断点 | 行为 |
| --- | --- |
| `≥1240px` | 文章侧边目录 `.article-toc` 显示，浮在 `left: calc(50% + 400px)`、宽 210px；`1240` 是为避免 1220px 布局溢出取整 |
| `≤900px` | 导航链接收起为 `.menu-toggle` 下拉；footer / `.module-grid` / `.cmd-grid` 全部改 1 列 |
| `≤700px` | `.api-table` 改横向滚动（th/td `white-space: nowrap`，末列允许换行）；`.prev-next` 改 1 列；筛选按钮 ≥44px 且 `.filter-bar` 改单行横向滚动 chips（`flex-wrap: nowrap` + `overscroll-behavior-x: contain`）；文章标题 1.18rem / 1.4；hero 行高 1.18 |
| `≤600px` | `--nav-height: 62px`；`.container` 左右 `--sp-4`；回顶按钮右下 18px |

其余：`img { max-width: 100% }`；`body { overflow-x: hidden }` 但**不允许靠它掩盖真实溢出**，页面本身应无横向滚动；`html { scroll-padding-top: calc(var(--nav-height) + 20px) }` 保证锚点不被 sticky 顶栏盖住；`@media (prefers-reduced-motion: reduce)` 把动画/过渡压到 `0.01ms` 并关闭平滑滚动。

---

## 9. Agent Prompt Guide

### Quick token reference

```css
/* 新卡片：直接照抄这套组合，不要自创颜色 */
.my-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
  transition: transform var(--dur-mid) var(--ease-out), border-color var(--dur-fast);
}
.my-card:hover { transform: translateY(-3px); border-color: var(--accent-rust); }
.my-card:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
.my-card .label {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--accent-rust-text);
}
```

配色速记：底 `#0b0d16` / 卡 `#1a1d2e` / 字 `#ede9df` / 次字 `#b8bcd0` / 元信息 `#8a8ea8` / 强调文字 `#d4692a` / 强调边框 `#b8581d` / 代码绿 `#4a9e7f`。浅色一律走语义变量，不要照抄深色十六进制。

### Example prompts

- 「按 DESIGN.md 新增一篇文章页：复用 `post/<id>/` 模板的 head 顺序与主题脚本，正文用 `.article-body`，5 节各配 `.section-marker`，数据先进 `.api-table`，核对框控制在 400 字内；不要改 `home/design-tokens.css`。」
- 「在归档页加一张主题卡片：用 `--bg-card` / `--line` / `--r-lg`，标题 `--font-display`，摘要限宽 `--measure`，hover 用 `translateY(-3px)`；只改 `home/home.html` 内联样式。」
- 「调整某个全站标题节奏：在 `home/design-tokens.css` 的 `EDITORIAL REFINEMENT` 区块追加 `html body` 前缀规则，纯追加不删旧规则，改完跑 lint 并同步本文件第 3 节。」

### Iteration guide

1. 先读本文件 → 再读 `home/design-tokens.css` 对应区块（以 CSS 为准）。
2. 只动该动的一层：全站 → token 层；文章阅读 → `article-read.css`；单页 → 该页内联 `<style>`。
3. 本地起 `python -m http.server 8765`（`file://` 下导航页 fetch 会 CORS 失败），桌面 1440 / 手机 390 各看一遍，检查无横向溢出。
4. `node scripts/repo-lint.cjs` → 新稿再加 `readability.cjs` → 提交走 `node scripts/daily-run.cjs`。
5. 若改了 token 定义或断点，**同步更新本文件对应表格**，否则规范会漂移。

---

## 10. 验收清单

- [ ] `node scripts/repo-lint.cjs` 输出「全部通过」；易读性样式 / canonical / og:image / twitter:card / JSON-LD 各项覆盖率**分子等于分母**。
- [ ] 幂等脚本 `--check` 全部归零：`apply-read-css.cjs`、`apply-seo-meta.cjs`、`apply-shared-css.cjs`、`home-static.cjs`、`apply-image-attrs.cjs`、`cover-webp.cjs`、`apply-head-hints.cjs`、`apply-site-meta.cjs`、`apply-skip-link.cjs`。
- [ ] head hints / 语义结构两节覆盖率分子等于分母；`feed.xml` 全量条目数与 `sitemap.xml` 里 `/post/` URL 数相等。
- [ ] 静态页 SEO 5/5（canonical 与 sitemap `<loc>` 逐字对齐、JSON-LD 类型正确）；`404.html` 与 `nav/stars/index.html` 仍为 `noindex`。
- [ ] `emfont CSS 并行加载 165/165`、`fonts.css 无 @import`；165 是引用了 `fonts.css` 的页数，跳转页不带字体 link 是正常的。
- [ ] `skip-link` 166/166：Tab 第一下聚焦、聚焦时元素可见（`top ≥ 0`）、Enter 后 `hash=#main-content` 且焦点落到主内容；禁用 JS 时链接仍在。
- [ ] 新稿冒烟（`build-article.cjs --spec … --out <临时目录>`）产物自带 head hints / SEO / skip-link，且 `repo-lint` 覆盖率不因新页而红。
- [ ] 点主题按钮后 `meta[name=theme-color]` 从 `#0b0d16` 变 `#f4efe4`，再点还原；禁用 JS 时静态值仍是 `#0b0d16`。
- [ ] 每个生产 HTML 恰好 1 个 `<h1>`；`feed.xml` / `sitemap.xml` 能被 XML 解析器读通。
- [ ] 新文章 `node scripts/readability.cjs --file post/<id>/<id>.html` ≥75（三档：<60 重写、60–74 改写、≥75 通过）。
- [ ] 首页在 `javaScriptEnabled:false` 下四块静态兜底仍有内容；`home/articles.js` 必须 `defer`，渲染脚本必须包 `DOMContentLoaded`。
- [ ] 有封面的文章实测 `img.currentSrc` 结尾为 `.webp`，显示比例与图片原始比例一致；无封面的文章不得有空 `src` 破图或空 `.hero-image`。
- [ ] 深色 + 浅色两套主题都截图核对；正文小字对比度 ≥4.5:1。
- [ ] 桌面 1440 / 手机 390 均无横向溢出，触摸目标 ≥44px，键盘 Tab 焦点环可见。
- [ ] 本文件与 `home/design-tokens.css` 的数值、断点、组件名一致。
- [ ] 上线后 `pages build and deployment` 为 success（判状态用 `actions/runs`，不要用 `pages/builds/latest`）。
