# Skill: 信源雷达与评分闸门（source-radar）

> 版本 1.0（第一期 · 只挑不发）
> 每日定时任务与人工调用的运行手册。判断标准见同目录 preferences.md。

## 一、每日流程（agent 执行）

1. **跑雷达脚本**（收集本机留痕 + 手动收件箱）：
   `node scripts/source-radar.cjs 30`
   产出 `.tools/radar/candidates-<日期>.md` 的第一、二节。
2. **刷抖音推荐流**（IAB 登录态）：douyin.com 推荐 tab 滚动 10–15 屏，
   采集卡片标题与作者——推荐算法已学过用户口味，这是最准的信源。
3. **抖音收藏增量**：user/self → 收藏 tab（按收藏时间倒序），对照
   `.tools/radar/seen.json` 只取新增，滚到已见条目即停。
4. **刷小红书探索流**：xiaohongshu.com/explore 滚动约 10 屏采集笔记卡片；
   搜索通道（WebSearch site:xiaohongshu.com + 偏好关键词）仅作补充——
   站内笔记不被搜索引擎收录，搜索命中率天然低。
5. **GitHub 扫描**（WebFetch，本地直连不通）：
   - 月度 / 周度趋势：`github.com/trending?since=monthly` 与 `weekly`
   - 新库查询：`api.github.com/search/repositories?q=created:>7天前+topic:ai|llm|agent&sort=stars`
6. **打分**：对每条候选按下方评分表打 0–100 分，对照 `.tools/radar/seen.json`
   去重（含「超级工程师」多平台搬运教训：同内容只留一份）。
7. **发布**：≥75 分全部走第三节管线整理发布，**数量不设上限，质量是唯一
   门槛**；50–74 写入待定清单；<50 丢弃。已发布条目追加进 seen.json 防重复。
8. **产出日报**：发布了什么（分数+链接）、待定什么、丢了什么，汇报给用户。

## 二、评分表（0–100）

| 维度 | 分值 | 打法 |
| --- | --- | --- |
| 主题契合 | 30 | 对照 preferences.md 主题优先级，★★★ 满分、★ 减半 |
| 可验证性 | 20 | 找得到原始实体并核对过 20；只找到二手转述 10；找不到 0 |
| 热度信号 | 20 | 30 万赞 / 周 +3 千星 级别 20；万级 12；无信号 5 |
| 重复度 | 15 | 与 articles.js 全量标题归一化比对（含「超级工程师」教训），撞车 0 |
| 标题健康度 | 15 | 可去夸张化改写的 15；夸张到无法救的 5 |

**档位**：≥75 直接进发布线（数量不设上限）｜50–74 待定清单｜<50 丢弃。
**硬条件**（preferences.md 第二节）不满足的直接丢弃，不打分。

## 三、上传流程

走既有管线，不新造轮子：
- 抖音 → `generate.js`（batch JSON 由 agent 按模板填）→ `repo-lint --fix` → `build-index`
- 微信 → `wx-post-quick.cjs` / `auto-publish.cjs`
- 小红书 → `skills/xhs-post-skill`
- category 必须填语义主题桶，禁止落杂项（除非真杂项）
- 封面保存为 post/<id>/cover.jpg——**目录名必须与 batch JSON 的 id 完全一致**
  （2026-10-25 曾因目录名手滑存错导致封面 404）；generate 之后校验
  `post/<id>/cover.jpg` 存在且大于 10KB，不满足不发布
- 原榜的星标数据若无法与 GitHub 对账，文章只保留「干什么、用在哪」并
  标注「以仓库实时数据为准」，不得把来路不明的星标当事实引用

## 四、信源边界（当前能力）

| 信源 | 状态 | 说明 |
| --- | --- | --- |
| 本机浏览器留痕（抖音/公众号/小红书网页端） | ✅ 自动 | 覆盖 PC 端看过的内容；手机 App 记录不可及 |
| 内置浏览器登录态直读（小红书/抖音） | ✅ 半自动 | 完整操作规程见 `skills/taste-scan/SKILL.md`（2026-10-24 实测：XHS 96 条、抖音喜欢 58 / 收藏 39 / 历史 11） |
| 手动收件箱 `.tools/radar/inbox.txt` | ✅ 自动 | 每行一个链接，读后清空 |
| GitHub 趋势 + 新库 API | ✅ agent | 本地直连 GitHub 被阻断，必须走 WebFetch |
| 小红书发现 | ⚠️ 搜索通道 | 站内 feed 有签名墙；用搜索引擎站内检索近似 |
| 微信公众号更新 | ⛔ 第二期 | 需自托管 wewe-rss，订阅新文章而非翻历史 |
| 抖音指定创作者 | ⛔ 第二期 | 主页接口需登录态，先靠留痕 + 收件箱覆盖 |
