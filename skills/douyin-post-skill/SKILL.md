# Skill: 抖音搬运文章生成 (douyin-post-skill)

> 版本: 1.0
> 适用项目: expectopatronus00.github.io (纯静态 GitHub Pages 博客)
> 依赖: Font Awesome 6.5.2 CDN, 浏览器环境

---

## 一、Skill 用途

**给我一个抖音链接，输出一篇结构完整、可部署的博客文章。**

本 Skill 用于将一条抖音视频（作者口述+画面+字幕）转化为一篇图文并茂的深度文章，自动融入 EXPECTOPATRONUS 博客的整体视觉体系，并在首页和文章库同步更新。

---

## 二、用户输入格式

用户会给出类似这样的消息片段：

```
7.10 复制打开抖音，看看【XXX的作品】标题文字...
https://v.douyin.com/xxxxxxx/
2026-06-16 8:00pm WMJ:/ g@B.TY
内容文章合并，并实现多平台链接形成文章内容
```

**必须从输入中提取的关键信息：**

| 字段 | 说明 | 示例 |
|------|------|------|
| `VIDEO_URL` | 抖音短链，或已展开的 `douyin.com/video/` 链接 | `https://v.douyin.com/iLabcdef/` |
| `AUTHOR` | 作者昵称（"【】" 内的内容） | `AI风向标` |
| `TITLE` | 视频标题 / 作品标题 | `顶级AI模型遭封禁，Anthropic硬刚美国监管！` |
| `DATE_TODAY` | 今日日期，作为发布日期 | `2026-06-16` |

**如果链接需要展开，用浏览器访问短链，从地址栏获取最终的 `https://www.douyin.com/video/{VIDEO_ID}` 形式。**

`VIDEO_ID` = URL 中 `/video/` 后的数字（如 `7651945427952078131`）。

---

## 三、操作流程（Agent 必须严格按此顺序执行）

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
   ├── 时间线卡片 (dy-timeline) - 适合事件型/发展史主题
   ├── 引用 block (dy-quote) - 适合名人言论/核心观点/争议焦点
   ├── 三级小标题 (h3) - 二级章节内的细分点
[CTA 区] 封面缩略图 + 「去抖音看完整视频」按钮 + 「官方站」按钮
[多平台卡片] 6~10 个相关平台（见下方表）
[话题标签] 8~12 个 #标签
[相关文章] 2 个链接，指向 home.html 或站内已有文章
```

#### 2.2 多平台卡片推荐库（根据文章主题挑选 8 个左右）

| 领域 | 平台/链接 | 图标 class |
|------|-----------|-----------|
| 通用 | 抖音原视频 | `fa-brands fa-tiktok` |
| AI / 大模型 | Anthropic | `fa-solid fa-robot` |
| AI / 大模型 | DeepSeek | `fa-solid fa-brain` |
| AI / 大模型 | Google DeepMind | `fa-brands fa-google` |
| AI / 开源 | GitHub | `fa-brands fa-github` |
| AI / 开源 | HuggingFace | `fa-solid fa-face-smile` |
| AI / 论文 | arXiv | `fa-solid fa-book` |
| 科技公司 | AWS / 亚马逊 | `fa-brands fa-aws` |
| 科技公司 | 英伟达 | `fa-solid fa-microchip` |
| 政府监管 | 美国商务部 | `fa-solid fa-building-columns` |
| 讨论 | X / Twitter | `fa-brands fa-x-twitter` |
| 中文 | 知乎 | `fa-brands fa-zhihu` |
| 中文 | B 站 | `fa-brands fa-bilibili` |
| 财经 | 相关上市公司官网 | `fa-solid fa-chart-line` |

**卡片格式：**
```html
<a class="plat-card" href="URL" target="_blank" rel="noopener">
  <i class="图标class"></i>
  <span class="pn">平台名</span>
  <span class="pd">一句话简介</span>
</a>
```

#### 2.3 正文字数与风格要求

- 全文 **800~1500 字**
- 段落清晰，每段不超过 4 行
- 每个 h2 章节下至少 2 段正文或 1 个时间线/引用 block
- 关键术语用 `<span class="hl">...</span>` 高亮
- 引用的重要事实、争议观点用 `<div class="dy-quote"><p>...</p></div>` 包裹
- 时间序列内容用 `<div class="dy-timeline"><div class="tl-item">...</div></div>`

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

**注意：不创建单独的 style.css 或 script.js — 所有样式内联在 `<style>` 中，脚本内联在 `<script>` 中。** 这样保证文章自包含、零依赖引用问题。

#### 3.2 使用 `template.html` 填充内容

模板文件路径：`/workspace/skills/douyin-post-skill/template.html`

**需要替换的占位符：**

| 占位符 | 说明 |
|--------|------|
| `{{TITLE}}` | 文章大标题 |
| `{{META_DESC}}` | `<meta description>` 用的 150 字简介 |
| `{{META_KEYWORDS}}` | 逗号分隔关键词（10~15 个） |
| `{{OG_TITLE}}` | og:title，通常和 TITLE 一致 |
| `{{OG_DESC}}` | og:description，通常和 META_DESC 一致 |
| `{{AUTHOR}}` | 作者名（如 "AI风向标"） |
| `{{DATE_TODAY}}` | 日期（如 "2026-06-16"） |
| `{{DURATION}}` | 阅读时长（如 "3 分 26 秒"，按文章长度估算） |
| `{{CATEGORY}}` | 固定写 "抖音搬运 · 内容主题"（内容主题如：AI监管 / 开源项目 / 技术趋势） |
| `{{COVER_URL}}` | 抖音封面图完整 URL |
| `{{SUMMARY_HTML}}` | 简介 block 中的文字内容（纯 HTML，不需要 `<p>` 包） |
| `{{CONTENT_HTML}}` | 正文主要内容（所有 h2 / 时间线 / 引用 的完整 HTML） |
| `{{VIDEO_ID}}` | 抖音视频 ID 数字 |
| `{{PLATFORMS_HTML}}` | 多平台卡片完整 HTML |
| `{{TAGS_HTML}}` | 标签 `<a>` 列表，每个标签单独一行 |
| `{{RELATED_HTML}}` | 相关文章 2 个 `<a>` |
| `{{OFFICIAL_SITE_NAME}}` | CTA 第二个按钮显示的名字（如 "Anthropic 官方站"） |
| `{{OFFICIAL_SITE_URL}}` | CTA 第二个按钮的 URL（如 "https://www.anthropic.com"） |
| `{{BREADCRUMB}}` | 面包屑最后一段文字，通常和大标题一致或简写（如 "抖音搬运：顶级AI模型遭封禁"） |

### 阶段 4: 更新文章库 (home.html)

在 `/workspace/home/home.html` 中做 3 处修改：

**修改 A: 更新统计数字（3 个数字）**
- `精选 N 篇内容` → N+1
- `<b>N</b><span>总数</span>` → N+1
- `<b>N</b><span>文章总数</span>` → N+1

**修改 B: 更新 cat-stats 分类统计区**
- 在 `cat-stats` 区的各个卡片中，`抖音搬运` 这一栏的数字 +1

**修改 C: 追加 articles 数组项**
在 `var articles = [...]` 数组的**最前面**（数组第一个元素位置）追加：

```js
{ id:"dy-{VIDEO_ID}", title:"{{TITLE}}", url:"../post/dy-{VIDEO_ID}/dy-{VIDEO_ID}.html", summary:"{{1句话摘要}}", category:"抖音搬运", date:"{{DATE_TODAY}}", read:{{估算分钟}}, tags:["{{标签1}}","{{标签2}}","..."], feat:true },
```

**保留其他元素不要改动。**

### 阶段 5: 更新首页排行榜 (index.html)

在 `/workspace/index.html` 中做 2 处修改：

**修改 A: 更新统计数字（2 处）**
- `stats-item` 区的 `内容总数` +1
- `平均更新频率` 如果有变化也更新（保持 1~3 天即可）

**修改 B: 追加排行榜 rank-card**
在 `热门文章排行榜` 区块的 **最前面**（第一个 rank-card 位置）追加：

```html
<a class="rank-card" href="./post/dy-{VIDEO_ID}/dy-{VIDEO_ID}.html">
  <div class="rank-medal">1</div>
  <div>
    <h4>{{TITLE}}</h4>
    <div class="meta-line">
      <span class="cat">抖音搬运</span>
      <span class="d">{{DATE_TODAY}}</span>
      <span class="r"><i class="fa-regular fa-clock"></i> {{DURATION}}</span>
    </div>
  </div>
  <span class="go"><i class="fa-solid fa-arrow-up-right-from-square"></i> 阅读</span>
</a>
```

**注意：原有的第 1 条会自动下移为第 2 条，需要把 `rank-medal` 里的数字顺次 +1。**

**修改 C: 追加精选文章 articles 数组**
在 `<h2>最新 抖音搬运</h2>` 下方的卡片网格中，**最前面**追加新文章卡片。格式参照已有卡片。

### 阶段 6: 验证

**必须做以下验证才能算完成：**

1. **代码检查**: `cd /workspace && npm run lint` 不应有新文章引入的错误
2. **浏览器验证**: 用浏览器工具打开 `file:///workspace/post/dy-{VIDEO_ID}/dy-{VIDEO_ID}.html`，确认：
   - 封面图正常加载（抖音图片外链通常可访问）
   - 字体图标（Font Awesome）正常显示
   - 主题切换按钮（月亮/太阳）可点击
   - CTA 按钮点击能正常打开抖音原页
   - 多平台卡片能正常跳转
3. **文章库验证**: 访问 home.html，检查新文章卡片显示、分类统计数字正确
4. **首页验证**: 访问 index.html，检查排行榜和最新搬运卡片正常

### 阶段 7: Git 推送

```bash
cd /workspace
git add -A
git commit -m "feat: 新增抖音搬运文章 - {{TITLE}}"
git push origin HEAD:main --force
```

---

## 四、样式参考

所有视觉参数定义于模板 `<style>` 中，**不要修改 CSS 变量的值**，以保持全站一致：

- `--bg-0` 背景色 / `--bg-1` 卡片背景
- `--ink` 主文字 / `--mute` 次要文字
- `--cyan` 强调色（亮青）/ `--pink` 点缀色（粉紫）
- `--line` 分割线 / `--accent-grad` 渐变

响应式断点：
- `max-width: 820px` — 平板/大屏手机
- `max-width: 480px` — 手机

---

## 五、已有文章参考（Agent 可用来校准风格）

| 路径 | 主题 | 风格 |
|------|------|------|
| `/workspace/post/dy-7641962519699017001/dy-7641962519699017001.html` | Gemini × Composer 踢馆赛 | 事件对比型 |
| `/workspace/post/dy-7646747643204900836/dy-7646747643204900836.html` | Harness starter 开源 | 工具介绍型 |
| `/workspace/post/dy-7651945427952078131/dy-7651945427952078131.html` | Anthropic 封禁事件 | 深度分析型 |

---

## 六、常见问题

**Q: 抖音封面图加载失败怎么办？**
A: 抖音的图片链接带 `x-expires` 和 `x-signature`，有过期时间。如果发现 403，直接用抖音打开视频，重新提取封面；或者用 `https://images.unsplash.com/...` 同主题的免费图片替代。

**Q: 视频有作者水印，需要保留吗？**
A: 封面自带的水印是作者信息，属于作者内容的一部分，保留即可。正文 CTA 区已声明"内容归原作者所有"。

**Q: articles 数组的 `feat:true` 何时加？**
A: 所有新文章都加 `feat:true`，表示"最新精选"，老文章的 `feat:true` 如果已有 2 篇以上，把最老的那个去掉。

**Q: 日期填什么？**
A: 一律用用户消息里的日期（或当天日期），格式 `YYYY-MM-DD`。

---

## 七、自检清单（每次调用前过一遍）

- [ ] 提取了 VIDEO_ID、AUTHOR、TITLE、封面 URL
- [ ] 文章内容是原创重述，不是逐字复制
- [ ] 生成了 dy-{VIDEO_ID}/dy-{VIDEO_ID}.html
- [ ] 更新了 home.html 的 articles 数组、统计数字、分类统计
- [ ] 更新了 index.html 的排行榜和精选卡片
- [ ] npm run lint 无新错误
- [ ] 浏览器打开验证通过
- [ ] 已 git push
