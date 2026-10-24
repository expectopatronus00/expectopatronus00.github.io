# Skill: 信源雷达与评分闸门（source-radar）

> 版本 1.0（第一期 · 只挑不发）
> 每日定时任务与人工调用的运行手册。判断标准见同目录 preferences.md。

## 一、每日流程（agent 执行）

1. **跑雷达脚本**（收集本机留痕 + 手动收件箱）：
   `node scripts/source-radar.cjs 30`
   产出 `.tools/radar/candidates-<日期>.md` 的第一、二节。
2. **GitHub 扫描**（WebFetch，本地直连不通）：
   - 月度 / 周度趋势：`github.com/trending?since=monthly` 与 `weekly`，按语言各取一页
   - 新库查询：`api.github.com/search/repositories?q=created:>7天前+topic:ai|llm|agent&sort=stars`
   - 与 preferences.md 的主题优先级对照，筛出 ≤5 条
3. **小红书发现（v1 搜索通道）**：
   自动刷 feed 需要签名，一期不做。用 WebSearch 查
   `site:xiaohongshu.com` + 偏好画像里的主题关键词（如 看盘工具 开源 AI 热力图），
   从公开搜索结果里发现笔记；发现后尝试 WebFetch 笔记页拿标题与作者。
4. **打分**：对每条候选按下方评分表打 0–100 分，写入候选清单。
5. **产出日报**：收了什么（分数+理由）、待定什么、丢了什么，汇报给用户。
   **不发布、不推送**——进入生成需用户点头（第二期改为限额直发）。

## 二、评分表（0–100）

| 维度 | 分值 | 打法 |
| --- | --- | --- |
| 主题契合 | 30 | 对照 preferences.md 主题优先级，★★★ 满分、★ 减半 |
| 可验证性 | 20 | 找得到原始实体并核对过 20；只找到二手转述 10；找不到 0 |
| 热度信号 | 20 | 30 万赞 / 周 +3 千星 级别 20；万级 12；无信号 5 |
| 重复度 | 15 | 与 articles.js 全量标题归一化比对（含「超级工程师」教训），撞车 0 |
| 标题健康度 | 15 | 可去夸张化改写的 15；夸张到无法救的 5 |

**档位**：≥75 进生成草稿（当天最多 3 篇）｜50–74 待定清单｜<50 丢弃。
**硬条件**（preferences.md 第二节）不满足的直接丢弃，不打分。

## 三、上传流程（用户点头后）

走既有管线，不新造轮子：
- 抖音 → `generate.js`（batch JSON 由 agent 按模板填）→ `repo-lint --fix` → `build-index`
- 微信 → `wx-post-quick.cjs` / `auto-publish.cjs`
- 小红书 → `skills/xhs-post-skill`
- category 必须填语义主题桶，禁止落杂项（除非真杂项）

## 四、信源边界（当前能力）

| 信源 | 状态 | 说明 |
| --- | --- | --- |
| 本机浏览器留痕（抖音/公众号/小红书网页端） | ✅ 自动 | 覆盖 PC 端看过的内容；手机 App 记录不可及 |
| 手动收件箱 `.tools/radar/inbox.txt` | ✅ 自动 | 每行一个链接，读后清空 |
| GitHub 趋势 + 新库 API | ✅ agent | 本地直连 GitHub 被阻断，必须走 WebFetch |
| 小红书发现 | ⚠️ 搜索通道 | 站内 feed 有签名墙；用搜索引擎站内检索近似 |
| 微信公众号更新 | ⛔ 第二期 | 需自托管 wewe-rss，订阅新文章而非翻历史 |
| 抖音指定创作者 | ⛔ 第二期 | 主页接口需登录态，先靠留痕 + 收件箱覆盖 |
