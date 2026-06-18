# repo-lint-skill · 仓库一致性检查 Skill

> 版本: 1.0
> 适用项目: expectopatronus00.github.io（纯静态 GitHub Pages 博客）
> 触发场景: 每次新增/删除文章后、推送前、用户询问"文章数量对不对"时

---

## 一、Skill 用途

本 Skill 用于保证仓库中 **文章文件** 与 **前端页面显示** 的一致性。典型问题场景：

- ✅ post/ 目录有 22 个 html，但 home.html 的 articles 数组只写了 21 条
- ✅ home.html 的 articles 数组有 22 条，但页面显示的"共 24 篇"没更新
- ✅ index.html hero 区域显示"19 articles"，但实际有 22 篇
- ✅ articles 数组中引用了不存在的文件路径（死链）
- ✅ 有真实文章文件但没加到 articles 数组（孤链）
- ✅ favicon 混用 logo.svg / 50.png

本 Skill 解决的就是：**把这些重复的人工检查变成一条命令**。

---

## 二、触发时机

**Agent 必须在以下情况自动调用本 Skill：**

1. 用户说"文章数量对不对"、"检查文章"、"某某文章有没有显示"等类似问题
2. 用户要求推送（push）之前，先跑一次
3. 生成新文章（douyin-post-skill 或 note-skill）完成后
4. 删除文件（冗余清理等操作）完成后

---

## 三、使用方法

```bash
cd /workspace
node scripts/repo-lint.cjs            # 只读模式，仅报告问题
node scripts/repo-lint.cjs --fix       # 自动修复显示数字（共 N 篇、hero articles）
```

**退出码：** `0` 表示无问题，`1` 表示有问题需要关注。

---

## 四、检查项一览

脚本会依次执行以下 6 项检查：

| # | 检查项 | 说明 | 自动修复 |
|---|--------|------|---------|
| 1 | 文章数一致性 | `post/` 物理 html 数 vs `home.html` articles 条目数 vs 显示数字 | ✅ --fix |
| 2 | 死链检测 | articles 数组中每条 url 指向的文件是否真实存在 | ❌ 需手工 |
| 3 | 文章反查 | post/ 中所有 html 是否都在 articles 数组中被引用 | ❌ 需手工 |
| 4 | 重复检测 | 是否有重复 id 或重复标题 | ❌ 需人工确认 |
| 5 | index.html hero 数字 | hero-stats 的 articles 数字是否等于真实文章数 | ✅ --fix |
| 6 | favicon 一致性 | 所有 html 是否都引用 `logo.svg`，不再有残留的 50.png | ❌ 需手工 |

---

## 五、Agent 操作流程

### 阶段 1: 运行检查

```bash
cd /workspace
node scripts/repo-lint.cjs
```

仔细阅读输出中的所有 ❌ 行。

### 阶段 2: 处理发现的问题

| 问题类型 | 如何处理 |
|---------|---------|
| 文章数不一致 | 运行 `--fix` 自动修正，或手工调整 articles 数组 |
| 死链 | 打开 home.html，找到对应 id，修正 url 或删除该条 |
| 孤链（有文件但未引用） | 把对应条目追加到 home.html 的 articles 数组，注意按日期倒序 |
| 重复 id | 确认是否是疏忽，若属实则删除重复条目 |
| 重复标题 | 可能是故意的（如同主题两篇），**先问用户**再决定 |
| favicon 残留 50.png | 批量替换为 `logo.svg` 路径（注意层级：从 post/deepseek 是 `../../../home/logo.svg`） |

### 阶段 3: 二次确认（必须）

修复后 **再次** 运行 `node scripts/repo-lint.cjs`，直到输出 `✅ 全部通过` 才允许继续。

### 阶段 4: 推送

```bash
cd /workspace
git add -A
git commit -m "chore(repo-lint): 修复文章数与 favicon 一致性"
git push origin main
```

---

## 六、核心路径速查

| 路径 | 作用 |
|------|------|
| `scripts/repo-lint.cjs` | 检查脚本本体 |
| `home/home.html` | articles 数组、"共 N 篇"显示 |
| `index.html` | hero-stats 第一个数字（articles 数） |
| `post/**/*.html` | 文章文件 |
| `home/logo.svg` | 全站 favicon（矢量 logo） |

---

## 七、示例输出解读

**干净状态示例：**

```
━━━━━ 文章数一致性 ━━━━━
  ✅  post/ 物理 html 文件数                   22
  ✅  home.html articles 数组条目数            22
  ✅  home.html "共 N 篇" 显示                22
━━━━━ 死链检测 ━━━━━
  ✅  所有 articles 指向的 html 文件均存在
━━━━━ 文章反查 ━━━━━
  ✅  所有 post/ 下的 html 文件都已在 articles 中列出
━━━━━ 重复检测 ━━━━━
  ✅  无重复 ID，无重复标题
━━━━━ index.html hero 数字 ━━━━━
  ✅  index.html · hero articles              22
━━━━━ favicon 一致性 ━━━━━
  ✅  使用 logo.svg                           25 个文件
━━━━━ 总览 ━━━━━
  ✅  全部通过，仓库状态干净
```

**有问题状态示例及应对：**

```
━━━━━ 文章数一致性 ━━━━━
  ✅  post/ 物理 html 文件数                   22
  ✅  home.html articles 数组条目数            22
  ❌  home.html "共 N 篇" 显示                21
```

→ 运行 `node scripts/repo-lint.cjs --fix`

```
━━━━━ 死链检测 ━━━━━
  ❌  死链 [dy-7650000000000000001]         ../post/dy-xxx/dy-xxx.html
```

→ 手工打开 home.html，找到该 id 条目，修正 url 或删除整条

```
━━━━━ 文章反查 ━━━━━
  ❌  未在 articles 中引用                    post/xxx-new/xxx-new.html
```

→ 把该文章按日期插入 articles 数组

---

## 八、扩展说明

- `--fix` 仅修复**显示数字不匹配**的问题（home.html 的"共 N 篇"和 index.html 的 hero articles 数）
- 死链、孤链、重复 id、favicon 残留等结构性问题需要**手工确认**再修正，避免误删
- 脚本输出为结构化文本，后续若接入 CI 可直接解析
