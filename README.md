# expectopatronus

一个 AI 工具与实战的中文学习归档。原创的踩坑记录，加上精选的转载——每篇都标注来源。

线上地址：<https://expectopatronus00.github.io>

## 内容定位

- **原创**：自己动手跑过的东西。踩坑记录、压测数字、部署过程。
- **转载**：抖音 / 小红书 / 微信公众号上值得留下的内容，重写整理后归档，标题不做夸张化处理，文末保留原文出处。
- 每篇文章都带来源标记（原创 / 抖音 / 小红书 / 微信），列表页和文章页都能看到。

## 目录结构

```
index.html                  首页（hero / 系列 / 主题 / 最近更新，全部由 JS 渲染）
feed.xml                    全站 RSS，由 scripts/build-index.cjs 生成
sitemap.xml                 站点地图，同上

home/
  home.html                 文章归档页（搜索 + 主题筛选 + 按月分组）
  series.html               系列连载（按序号排列的成组文章）
  about.html                关于 / now / 转载规则 / 技术说明
  articles.js               文章数据源（window.articles）+ 派生层（window.BLOG）
  design-tokens.css         全站设计令牌与共享组件
  fonts.css                 字体加载（拉丁自托管 + 中文 CDN 分片）

post/
  article.js                文章页增强脚本（目录 / 进度条 / 上下篇 / 相关阅读）
  <id>/<id>.html            每篇文章独立目录

nav/                        AI 工具导航站（读 data.json）

scripts/
  repo-lint.cjs             仓库一致性检查（文章数 / 死链 / 孤儿页 / 重复）
  build-index.cjs           生成 feed.xml 与 sitemap.xml
  enhance-articles.cjs      给文章页批量注入 post/article.js
  daily-run.cjs             每日收尾：检查 → 重建索引 → 提交推送 → 通知
  site-health.cjs           站点健康检查（feed 完整性 / 线上探活 / 断更）
  notify.cjs                统一通知出口，所有自动化环节都调它
  auto-publish.cjs          一条链接走完抓取 → 生成 → 发布

.github/workflows/
  health.yml                每日云端校验（只做确定性检查，不抓站）

skills/                     内容生成 Skill（抖音 / 小红书 / 导航站）
docs/                       设计与内容规划文档
```

## 本地开发

```bash
npm install          # 只装开发依赖（eslint / prettier / stylelint / live-server）
npm run dev          # http://localhost:5500
```

没有构建步骤。改完文件刷新浏览器就能看到。

## 常用脚本

```bash
node scripts/repo-lint.cjs        # 一致性检查，改了文章列表后跑一次
node scripts/repo-lint.cjs --fix  # 顺手修正首页与归档页的显示数字
node scripts/build-index.cjs      # 重新生成 feed.xml 与 sitemap.xml
node scripts/enhance-articles.cjs # 给新增的文章页注入文章增强脚本

node scripts/daily-run.cjs        # 每日收尾：检查 → 重建索引 → 提交推送 → 通知
node scripts/site-health.cjs      # 站点健康检查：feed 完整性 / 线上探活 / 断更检测
node scripts/notify.cjs --title "标题" --body "正文"   # 手动发一条通知
```

`daily-run.cjs` 只做「不需要判断」的那一段，采集、评分、写正文都不在里面（那些要
agent 参与，见 `skills/source-radar/SKILL.md`）。常用参数：`--no-push` 只检查不推、
`--dry-run` 全跑但不提交不通知、`--allow-lint-issues` 一致性检查有遗留问题时仍推送。

通知渠道在仓库根目录 `.env` 里配（已 gitignore，模板见 `.env.example`），支持
Telegram / Bark / Server 酱 / 飞书 / 企业微信 / 钉钉 / 通用 webhook。一个都没配时，
`notify.cjs` 只把内容打印到终端，不会报错。

`build-index.cjs` 的站点地址默认取 GitHub Pages 域名，绑了自定义域名的话：

```bash
SITE_URL=https://your.domain node scripts/build-index.cjs
```

## 数据层约定

`home/articles.js` 上半部分是原始条目，由生成脚本维护，字段固定为：

```js
{ id, title, url, summary, category, date, tags }
```

下半部分是一个 IIFE 派生层，**不改原始数据**，只就地补齐：

| 字段 | 说明 |
| --- | --- |
| `source` | `原创` / `抖音` / `小红书` / `微信`，由 id 前缀推导 |
| `category` | 被覆盖为八个主题桶之一（原始的 21 个分类混了来源维度） |
| `categoryId` | 主题桶 id，如 `ai-code` |
| `legacyCategory` | 保留的原始分类值 |
| `series` | `{ id, name, index, total }`，属于某个系列时才有 |
| `hidden` | 已合并的重复文章，列表页不展示，页面本身保留避免 404 |

页面脚本统一从 `window.BLOG` 取数据：

```js
BLOG.visible        // 该显示的、已按日期倒序的文章
BLOG.categories     // 八个主题桶
BLOG.series         // 三个系列
BLOG.count          // { total, visible, original, repost }
BLOG.latest(n)      // 最近 n 篇
BLOG.inCategory(name)
BLOG.inSeries(id)
```

新增文章只需要往 `window.articles` 里加一条，派生层会自动补字段。

## 写作规范

- 中文正文每行 30–40 汉字（`max-width: 34–38em`），行高 1.75–1.9。
- 中英文之间、中文与数字之间手动加空格；度数与百分号不加。
- 转载文章必须有具体的原文链接，不能是搜索页；标题不做夸张化处理。
- 文章页正文用 `.section-marker` + `h2` 成对结构，目录会自动生成（少于 3 个 `h2` 不显示目录）。

## 技术说明

- 纯静态 HTML / CSS / 原生 JS，无框架、无构建，GitHub Pages 托管。
- JS 用 ES5 语法（`var` / `function`），不引入打包器。
- 设计令牌集中在 `home/design-tokens.css`，页面内联样式只写该页独有的部分。
- 字体：拉丁字体（Cormorant Garamond、Source Serif 4）自托管，中文走中文网字计划 CDN 分片——不依赖 Google Fonts。
- 图标全部内联 SVG，不加载图标字体库。
- 配色通过 WCAG AA 对比度校验，强调色的文字版本单独拆了 `--accent-rust-text` / `--accent-jade-text`。

## 截图自查

改完页面想确认视觉效果，用仓库里的 CDP 截图脚本（需要本机装了 Chrome）：

```bash
node .tools/shoot.cjs http://127.0.0.1:5500/home/home.html 1440 out.png
node .tools/shoot.cjs http://127.0.0.1:5500/home/home.html 390 out.png   # 移动端
node .tools/shoot.cjs http://127.0.0.1:5500/index.html 1440 out.png full  # 整页长图
```

不要直接用 `chrome --headless --window-size=390,900 --screenshot`：Windows 上窗口有最小宽度限制，
截出来的是「500px 视口裁到 390px」，会把正常页面误判成横向溢出。`.tools/shoot.cjs` 走 CDP 的
`Emulation.setDeviceMetricsOverride`，才是真的 390px 视口。

另外三个探测脚本，用来在无头环境里查问题：

```bash
node .tools/probe-errors.cjs <url>        # 抓 console 错误与未捕获异常
node .tools/probe-overflow.cjs <url> 390  # 列出所有超出视口宽度的元素
node .tools/probe-one.cjs <url> 5000 "<js表达式>"  # 等待后求值，验证渲染结果
```
