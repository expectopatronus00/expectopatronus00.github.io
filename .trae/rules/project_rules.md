# 项目规范

## 定位

一个 AI 工具与实战的中文学习归档：原创踩坑记录 + 精选转载，每篇都标注来源。

## 技术栈

- 纯静态 HTML/CSS/JS，无框架、**无构建步骤**
- GitHub Pages 托管
- 图标全部内联 SVG，不加载图标字体库
- 代码高亮用仓库里的 `.code-block` + `.kw` / `.cmt` / `.cmd` / `.arg` / `.num` 手写 span，不引 highlight.js

## 代码规范

### HTML

- 使用 `lang="zh-CN"` 声明语言
- 主题通过 `<html data-theme="dark|light">` 控制，`<head>` 里放一段内联脚本先读 `localStorage` 防止闪烁
- 内联 `<style>` 放在 `<head>` 中，`<script>` 放在 `<body>` 末尾
- 图片使用 `loading="lazy"` 懒加载
- 共享样式一律走 `home/design-tokens.css`，页面内联样式只写该页独有的部分
- 导航项固定五项：首页 / 文章 / 系列 / 关于 / 导航站

### CSS

- 使用 `home/design-tokens.css` 里的变量，不要自己新造一套
  - 颜色：`--bg` / `--bg-soft` / `--bg-card` / `--line` / `--line-soft` / `--text` / `--text-soft` / `--text-dim`
  - 强调：`--accent-rust`（装饰）/ `--accent-rust-text`（文字）/ `--accent-jade` / `--accent-jade-text` / `--accent-gold`
  - 间距：`--sp-1` (4px) … `--sp-12` (128px)，**没有 `--sp-11`**
  - 圆角：`--r-sm` (4px) / `--r-md` (8px) / `--r-lg` (14px) / `--r-xl` (22px)
  - 字体：`--font-display` / `--font-serif` / `--font-sans` / `--font-mono`
  - 布局：`--container` (1200px) / `--container-narrow` (780px) / `--nav-height` (72px)
- 深色/浅色主题通过 `[data-theme="light"]` 选择器覆盖
- 响应式断点：1200px / 1024px / 900px / 700px / 600px
- 强调色分两个变体：`--accent-rust` 只用于装饰（边框、下划线、背景），文字必须用 `--accent-rust-text`，否则深色底上不达 WCAG AA

### JavaScript

- 使用 ES5 兼容语法（`var` / `function` 声明），不引入打包器
- 主题切换通过 `localStorage` 持久化，key 固定为 `theme`
- 滚动动画使用 `IntersectionObserver`
- 页面脚本从 `window.BLOG` 取文章数据，不直接读 `window.articles`

## 数据层

`home/articles.js` 分两段：

1. **上半部分**（第 4 行起）：原始条目数组 `window.articles`，由生成脚本维护，字段固定 `{ id, title, url, summary, category, date, tags }`。**不要手改这一段**，改数据层逻辑应该改下半部分。
2. **下半部分**：派生层 IIFE，就地补齐 `source` / `category` / `categoryId` / `legacyCategory` / `series` / `hidden`，并导出 `window.BLOG`。

- `source` 由 id 前缀推导：`dy-` → 抖音、`xhs-` → 小红书、白名单 → 原创、其余 → 微信
- `category` 被覆盖为八个主题桶之一：AI 编程 / AI 工具 / AI 基础设施 / 运维与部署 / 量化与投资 / 效率与成长 / 健康与生活 / 杂项
- 需要给某篇文章指定主题桶时，加到派生层的 `CATEGORY_BY_ID` 表里
- 合并重复文章时，加到 `MERGED` 表，被合并的条目会自动 `hidden`

## 命名规范

- CSS 类名使用 kebab-case（如 `nav-links`, `article-row`）
- HTML 文件命名使用小写 + 连字符（如 `wx-b300-hardware.html`）
- 图片资源放在对应页面目录下

## 开发命令

- `npm run dev` — 启动本地开发服务器 (port 5500)
- `npm run lint` — JS 代码检查
- `npm run lint:fix` — JS 代码自动修复
- `npm run format` — 格式化所有代码
- `npm run lint:css` — CSS 代码检查
- `npm run check` — 运行全部检查

内容与构建相关：

- `node scripts/repo-lint.cjs` — 仓库一致性检查（文章数 / 死链 / 孤儿页 / 重复）
- `node scripts/repo-lint.cjs --fix` — 顺手修正显示数字
- `node scripts/build-index.cjs` — 重新生成 `feed.xml` 与 `sitemap.xml`
- `node scripts/enhance-articles.cjs` — 给新增文章页注入 `post/article.js`

## 写作规范

- 中文正文每行 30–40 汉字，行高 1.75–1.9
- 中英文之间、中文与数字之间手动加空格（`10 Gbps`、`5000 元`）；度数与百分号不加（`233°`、`15%`）
- 正文用 `.section-marker` + `h2` 成对结构，目录会自动生成（少于 3 个 `h2` 不显示）
- 转载文章必须有具体原文链接，不能是搜索页
- 标题不做夸张化处理，「炸了」「王炸」「神级」这类词改掉

## 注意事项

- 不要修改 `node_modules` 目录
- 不要提交 `.env` 等敏感文件
- 文章内容中的图片使用 CDN 外链，不存本地
- 抖音搬运文章的视频使用抖音官方 aweme/v1/play 接口
- `home/home.html` 里必须保留纯文本「共 N 篇」，`scripts/repo-lint.cjs` 用 `/共\s*(\d+)\s*篇/` 校验，中间不能插标签
- 归档页 `.article-row` 的日期列固定 108px：「2026 · 07 · 19」在 mono 0.76rem 下实测要 108px，改小会把最后一位数字裁掉
- 文章页的目录 / 进度条 / 上下篇 / 相关文章全部由 `post/article.js` 运行时生成，HTML 里不要手写这些结构
- 改完页面用 `node .tools/shoot.cjs <url> <宽度> <输出.png>` 截图自查：Windows 上 `chrome --window-size` 会受最小窗口宽度影响，直接截 390px 得到的是「500px 视口裁到 390px」，会误判成横向溢出
