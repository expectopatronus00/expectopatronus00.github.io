# Skill: 每日成稿（daily-writer）

> 版本 2.1（2026-11-10 起：新增第七节「易读性」硬规则与体检门槛）
> 这是三个成稿窗口（10:00 / 14:00 / 19:00）共用的唯一规范。
> 定时任务的 prompt 只负责「什么时候跑」，写什么、怎么写全部看这里。
>
> 2.1 变更：文章页已接入共享易读性层（post/article-read.css + post/article.js），
> 但样式救不了文字墙。第七节规定了段落长度、结构化块与数据核对写法，
> 成稿必须跑 `scripts/readability.cjs` 过 75 分才算完成。

## 一、产能与分工

| 窗口 | 任务 | 上限 |
| --- | --- | --- |
| 10:00 | 写 1 篇 | 1 |
| 14:00 | 写 1 篇 | 1 |
| 19:00 | 写 1 篇 | 1 |

- **单窗口只写 1 篇**，写完就停。不要在一个窗口里连写多篇——事实核对是最耗注意力的环节，第二篇开始质量必掉。
- 全天最多 3 篇。三个窗口互相独立：10:00 失败不影响 14:00，各自按当时的选题池挑。
- 每次开工先读 `.tools/radar/drafts.json`，**当天已有的 id 不许重写**。

## 二、选题优先级（这是提升产能的关键）

按下面顺序挑，第一条能落地就用第一条：

1. **积压最久的**：读 `.tools/radar/backlog.json`，取 `status: pending` 里 `addedAt` 最早的一条。积压超过 7 天的，先重新核对星标与热度——一周前的 89 分今天可能不值 89，掉到 75 以下就标记 `stale` 放回待定。
2. **同族合并**：backlog 里如果有 ≥2 条同 `family` 的候选，写一篇横评一次消耗 2–3 条。这是唯一能在不降质量的前提下把进量（4 条/天）压下去的办法。
3. **当日新增**：读 `.tools/radar/topics-<今天>.md` 的选题池，挑最高的那条。

同族例子：`context-mode` + `claude-mem` → 上下文与记忆横评；`security-audit-skill` + `claude-seo` → 专业领域 skill 系列。

## 三、选题硬条件（不满足就跳过，不许降分凑数）

- 能落到 GitHub 仓库 / 官方文档 / 论文 / 官网，且能用 WebFetch 核到具体数字（星标、创建时间、许可证、版本号）。
- 只在短视频口播里出现、落不到原始实体的，直接跳过。
- 与 `home/articles.js` 现有标题撞车的跳过；与 `seen.json` 已发布条目重复的跳过。

## 四、事实核对

- 本地直连 `github.com` 会超时，**必须用 WebFetch**：`https://api.github.com/repos/<owner>/<repo>` 取 `full_name` / `stargazers_count` / `forks_count` / `created_at` / `license` / `pushed_at`。
- 想验证「自述数字是否成立」，用 `https://api.github.com/repos/<owner>/<repo>/contents/<dir>` 数文件、看 size，比信 description 可靠。
- 正文里每个数字都要有来源，核不到的整句删掉。文末用 `<div class="info-box">` 写「数据核对：…（核对时间 2026-XX-XX）」。

## 五、成稿（两个文件 + 一条命令）

1. 正文片段写到 `.tools/draft/<id>.body.html`：从第一个 `<div class="section-marker">` 到最后一个 `<p>`，**不要**写 cta-box / platforms / tags-row。
2. spec 写到 `.tools/draft/<id>.json`：

```json
{
  "id": "gh-<owner>-<repo>",
  "title": "20-32 字，前半给事实、后半给判断",
  "desc": "≤160 字，用于 meta 与列表摘要",
  "eyebrow": "SKILL · 开源项目",
  "lead": "80-120 字导语，第一句就给最硬的数字",
  "date": "<YYYY-MM-DD>",
  "category": "AI 编程",
  "tags": ["Skill", "开源"],
  "bodyFile": "<id>.body.html",
  "cta": { "heading": "去看原始仓库", "text": "一句话说明它是什么", "href": "https://github.com/<owner>/<repo>", "label": "前往 GitHub" },
  "platforms": [{ "href": "https://github.com/<owner>/<repo>", "name": "GitHub", "icon": "github", "desc": "repo · 一句话" }],
  "cover": { "eyebrow": "OPEN SOURCE · AGENT SKILL", "kicker": "一句钩子（可含数字）", "headline": ["第一行", "第二行 <em>重点词</em>"], "sub": "一句话副题", "bars": [{ "label": "crap", "height": 96 }] },
  "source": { "key": "选题来源的原始标题（写进 seen.json 去重）" }
}
```

   `id` 只能小写字母/数字/连字符；`platforms[].icon` 可选 `github` / `web` / `video`，默认 `link`。
3. 运行（必须用这个 node 与 NODE_PATH，playwright 只装在隔离工作区）：

```
NODE_PATH=C:/Users/Administrator/.workbuddy-ai/binaries/node/workspace/node_modules "C:/Users/Administrator/.workbuddy-ai/binaries/node/versions/22.22.2-6/node.exe" scripts/build-article.cjs --spec .tools/draft/<id>.json --cover --index --remember
```

4. 跑 `node scripts/readability.cjs --file post/<id>/<id>.html`，按第七节判定；再跑 `node scripts/repo-lint.cjs`，必须「全部通过」。不通过就修到通过；修不动就只回滚这一篇（`git checkout -- home/articles.js home/home.html index.html && rm -rf post/<id>`），**不要影响同一天其他窗口已经写好的稿子**，并在邮件里说明失败原因。

## 六、文风（必须像站内既有文章）

- 结构：01 这件事 → 02 它规定了什么 / 核心机制 → 03 关键细节与数据 → 04 怎么用 → 05 冷思考。1800-3000 字，**5 节**，每节 2–4 段（单段 ≤140 字，见第七节）。
- 开头直接给事实（谁、什么时候、多少星），禁止「随着 AI 的快速发展」这类套话。
- 用 `<span class="hl">关键词</span>` 标重点，**全文 ≤8 处**且每段最多一处；`<code>` 放命令与阈值；`<div class="info-box">` 放数据核对或易误解点。
- 冷思考必须给具体质疑（热度里有多少是作者名气、阈值对个人项目的负担、不装配套工具会怎样），结尾落到一个判断，不要写总结。
- 标题不用「震惊」「炸裂」「必看」，不做标题党。
- 横评类文章：至少 2 个实体，每个都要有独立核对过的数字，最后给「什么情况下选 A、什么情况下选 B」的判断表。

## 七、易读性（成稿硬门槛）

这个站写的是 GitHub 数据密集型长文，最容易出现的问题不是错字，是「一段 400 字、8 个数字、10 个 `<code>`」。2026-11-10 全站体检：平均 82 分，但近三天的 GitHub 稿全部 29 分，全是文字墙。以下规则按条执行：

1. **段落 ≤140 字**（中文字符数），超过就在第一个句号处断开；单段 >180 字体检直接扣分。
2. **每节至少一个结构化块**：`<ul>` / `<ol>` 列表、`<table>` 表格，或 2 条以上 `<p><strong>小标题</strong>…</p>` 并列段。纯段落堆砌不合格。
3. **连续 3 个以上数字 / 命令 / 版本号改用列表或表格**，不要塞进一个句子。README 里的性能表、文件清单、release 列表一律表格化。
4. **`<div class="info-box">` 数据核对分条**：先一句总述，再 `<ul>` 分条列关键字段（仓库身份 / 版本 / 目录 / 性能 / 边界），最后单独一句核对时间；整框 ≤400 字。超长框页面会自动折叠，但折叠不等于可读，仍要自己拆。
5. **密度控制**：`<span class="hl">` 全文 ≤8 处；一句话里 `<code>` ≤2 个，全文每千字 ≤12 个。
6. **每节开头一句加粗判断句**（`<p><strong>…</strong>`），让读者只扫加粗句也能抓住全文结论。
7. 只用 `h2`，不套 `h3`；列表项以名词或动词开头，不写整句。

体检命令与判定：

```
node scripts/readability.cjs --file post/<id>/<id>.html
```

| 分数 | 判定 | 动作 |
| --- | --- | --- |
| ≥75 | 通过 | 进入收尾 |
| 60–74 | 建议改写 | 按输出的建议逐条改正文，重跑到 ≥75 |
| <60 | 不通过 | 重写正文结构，不是润色句子 |

`build-article.cjs` 渲染时也会打印同一分数，但**不阻断**；门槛只在这里执行。体检只量结构不量文采，不要为了刷分删掉核对过的数字——把数字搬进表格即可。

## 八、收尾

1. 从 `.tools/radar/backlog.json` 里把本篇消耗的条目状态改成 `published`（横评则改多条）。
2. 邮件正文写进临时文件，**必须严格按下面七行**（`notify.cjs` 识别到「标题：」开头会自动排成元信息表，URL 自动变成按钮）：

```
标题：<文章标题>
分类：<category> · <YYYY-MM-DD>
字数：<N> 字，<M> 节 · 易读性 <体检得分>/100
关键数字：<核到的最硬的 2-3 个数字，用 / 分隔>
本地路径：post/<id>/
预计上线：https://expectopatronus00.github.io/post/<id>/<id>.html
22:30 的 daily-run 会自动发布，若不想要请在 22:30 前告知。
```

3. 执行 `node scripts/notify.cjs --title "今日成稿 · <日期> · <文章标题>" --file <临时文件>`。
4. 对话里给同样摘要。

想先看效果不发信：加 `--dry-run --save-html .tools/shots/mail.html`，浏览器打开即可预览。

## 九、硬性约束

- **绝不 `git commit` / `git push`**，也绝不手动改 `feed.xml` / `sitemap.xml`（都由 22:30 的 daily-run 处理）。
- 不碰 `.env`、`.tools/browser-profile/`、`.tools/radar/auth.json`；禁止 `git add -f` 任何被忽略的文件。
- 不虚构数字、不虚构仓库存在性；核对不到就删掉那句话。
- 易读性体检 <75 分不许计入成稿，也不许发「已完成」邮件；改到过线再收尾。
- 单窗口最多 1 篇。候选不合格就空跑并说明，**空跑也算完成**，不要为了凑数硬写。
