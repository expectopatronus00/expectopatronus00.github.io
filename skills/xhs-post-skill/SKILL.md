# xhs-post-skill

小红书笔记文章生成技能。

## 用途

- 批量生成小红书笔记文章
- 自动更新 `articles.js`、`home.html`、`index.html`

## 批量模式

### 使用流程

1. 准备 `notes.json`（格式参见 `batch-template.json`）
2. 执行 `node skills/xhs-post-skill/generate.js path/to/notes.json`
3. 脚本自动完成：生成文章页、更新索引、运行一致性检查

### notes.json 格式

```json
[
  {
    "id": "xhs-NOTE_ID",
    "title": "文章标题",
    "eyebrow": "健康生活 · 饮食",
    "author": "作者昵称",
    "date": "2026-07-02",
    "cover": "封面图URL",
    "tags": ["健康生活", "干净饮食", "减脂"],
    "summary": "1句话摘要",
    "meta_desc": "meta description",
    "meta_keywords": "关键词",
    "category": "健康生活",
    "content_html": ["<h2>章节标题</h2>", "<p>段落内容...</p>"],
    "cta": {
      "title": "去小红书看原笔记",
      "desc": "点击跳转",
      "url": "https://www.xiaohongshu.com/discovery/item/NOTE_ID"
    }
  }
]
```

### 执行命令

```bash
node skills/xhs-post-skill/generate.js notes.json
```

## 单篇模式

通过 `scripts/auto-publish.cjs` 自动识别小红书链接并生成文章：

```bash
node scripts/auto-publish.cjs "标题 http://xhslink.com/o/xxx"
```

## 样式参考

模板支持以下组件类名：

- `section-marker` — 章节编号标签
- `info-box` — 信息提示框
- `pull-quote` — 重点引用块
- `image-card` — 图片卡片
- `check-list` — 勾选列表
- `bullet-list` — 圆点列表
- `tip-card` — 技巧卡片
- `timeline` — 时间线
- `hl` — 关键词高亮

## 输出文件

- `post/xhs-{ID}/xhs-{ID}.html` — 文章页
- `home/articles.js` — 更新 articles 数组
- `home/home.html` — 更新统计数字
- `index.html` — 更新 hero 统计