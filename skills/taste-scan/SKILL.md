# Skill: 口味采样（taste-scan）——刷站直读 + 画像蒸馏

> 版本 1.0
> 用途：周期性或按需地「刷一遍用户的小红书 / 抖音」，把浏览、点赞、收藏、
> 观看历史变成偏好画像的更新。这是 source-radar 评分闸门的记忆来源。
> 前置：用户已在 ZCode 内置浏览器登录小红书 / 抖音（IAB 会话与用户自用
> 浏览器互不相通；登录一次即持久于当前 ZCode 进程）。

## 一、操作总览

```
确认登录态 → 小红书浏览记录滚到底 → 抖音喜欢长滚动 → 收藏/观看历史到底
→ 关键词频率统计 → 蒸馏进 preferences.md「〇、实测画像」→ 日报
```

原始数据只落 `.tools/radar/taste-<日期>/`（已被 .gitignore），
**任何原始浏览条目不得进入公开仓库**；preferences.md 只写抽象画像。

## 二、小红书（浏览记录）

1. 打开 `https://www.xiaohongshu.com/user/profile/<uid>?tab=browseHistory`
   （本账号 uid：`607e60f00000000001001286`；换号时从 Edge 历史或页面「我」处取）。
2. 卡片选择器：`a[href*='/explore/']`，标题取 `a.closest('section')` 的
   innerText 第一行。以 href 去重。
3. **滚动用 window.scrollBy(0, 1800)**——小红书页面不使用抖音那套
   `.parent-route-container` 容器。
4. 连续 4–5 轮无新条目即到底；**接口对反复调用会限流**，一次会话别硬刷
   第二遍，隔天再采即可。

## 三、抖音（喜欢 / 收藏 / 观看历史）

1. 打开 `https://www.douyin.com/user/self`。顶部 tab：作品 / 推荐 / 喜欢 /
   收藏（锁）/ 观看历史（锁）/ 稍后再看（锁）。自己是登录态，锁只是隐私
   标记，能点开。
2. **点击 tab 会触发 SPA 重载、销毁执行上下文**：点击与读取必须分两个
   js cell。点击那格报的 ReferenceError（如 "r is not defined"）是假错误，
   点击已生效，下一格直接读。
3. **滚动容器是 `.parent-route-container`，不是 window**——页面
   scrollHeight 恒等于视口高。用 `container.scrollBy(0, 2200)`；
   window.scrollBy 是空转，cua.scroll 会超时。
4. **last_visit_time 类大整数注意**：node:sqlite 返回 BigInt 超 Number
   范围会抛 RangeError——Chrome 微秒时间戳要在 SQL 里
   `CAST(last_visit_time/1000000 - 11644473600 AS INTEGER)` 换算
   （见 scripts/source-radar.cjs 的实现）。
5. 采集循环：读 li → 标题去重（innerText 首段，过滤「消息」开头）→
   滚动 → 800ms 等待。连续 4 轮无新条目 = 到底。
6. 量级预期：喜欢 1.8 万全量不现实（~800 屏），按点赞时间倒序采到
   时间预算为止（500–1500 条已足够蒸馏）；收藏 / 观看历史可到底。

## 四、蒸馏与记忆更新

1. 关键词规则频率表（首中原则，规则随偏好演进增删）：
   - 模型接入/免费通道：`claude|deepseek|kimi|token|模型|接入|api|免费|白嫖`
   - GitHub/开源：`github|开源|仓库|热榜`
   - Agent Skills：`skill|SKILL|技能`
   - 编码/agent 工具：`codex|cursor|agent|智能体|编码|vibe|mcp|自动化`
   - 量化/看盘：`量化|股市|a股|看盘|因子|板块`
   - 本地部署/硬件：`显存|本地部署|整机|5080|4090`
   - 噪声：`漫剧|短剧|游戏|三角洲|眼镜|美食|旅游`
2. 统计占比 → 重写 preferences.md「〇、实测画像」一节（标注采样日期与
   条数，保留上一版的结论演进即可，不必留原始条目）。
3. 新出现的主题簇（如机器人/具身智能）加进 preferences.md 的观察清单，
   并考虑补进主题优先级表。

## 五、节奏建议

- 常规：每月一次全量采样足够（口味变化是月级别的）。
- 触发式：用户说「更新口味」「再刷一遍」时执行。
- 结果落地：更新 preferences.md → git commit + push（画像本身可公开，
  原始数据永不）。
