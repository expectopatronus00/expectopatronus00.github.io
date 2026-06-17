# AI 导航管理 Skill

管理 `nav/data.json` 中的 AI 网站链接数据，以及导航页面样式。

## 使用方式

当用户提供一个链接时，执行以下步骤：

### 1. 分析页面

- 使用 `WebFetch` 获取页面内容，提取：
  - **网站名称**：`<title>` 标签内容或 `<h1>`
  - **网站描述**：`<meta name="description">` 或首段文字
- 如果 `WebFetch` 失败（如微信文章需要验证），**直接询问用户提供文章标题和主题**，手动判断分类

### 2. 确定分类

根据网站功能和关键词，自动归入最合适的分类（参见 data.json 中的 `categories`）：

| 分类 ID        | 关键词                             |
| -------------- | ---------------------------------- |
| `cn-ai-chat`   | 国产对话、大模型、搜索             |
| `intl-ai-chat` | ChatGPT、Claude、Gemini 等国际对话 |
| `ai-model`     | API、模型平台、开源模型            |
| `ai-coding`    | 编程、代码、IDE、GitHub Copilot    |
| `ai-agent`     | Agent、自动化、工作流              |
| `ai-image`     | 绘画、图像生成、Midjourney         |
| `ai-video`     | 视频生成、Sora、Runway             |
| `ai-audio`     | 语音、TTS、克隆                    |
| `ai-learning`  | 课程、教程、论文                   |
| `ai-prompt`    | 提示词、Prompt                     |
| `dev-tools`    | 开发工具、API、部署                |
| `ai-news`      | 资讯、社区、新闻                   |

### 3. 更新数据

将新链接追加到 `nav/data.json` 对应分类的 `items` 数组中：

```json
{
  "name": "网站名称",
  "url": "https://...",
  "desc": "简短描述（不超过20字）",
  "badge": "可选标签，如 热门/免费/新"
}
```

### 4. 样式调整

当用户要求调整导航站样式时：

- 直接修改 `nav/index.html` 中的 CSS
- 修改后 `prettier --write nav/index.html`
- `git add nav/index.html && git commit && git push`

### 5. 确认与推送

- 告知用户：网站名称、URL、分配到的分类、总站点数
- **每次修改完成后必须 `git add`、`git commit`、`git push`**
- 不要等用户提醒，主动推送

## 批量添加

用户可一次性提供多个链接，用换行或逗号分隔，逐个处理后批量写入 data.json。

## 注意事项

- 同一 URL 不重复添加（先检查 data.json 中是否存在）
- 描述文字控制在 20 字以内
- badge 仅用于重要标签（热门/免费/新/开源/国内）
- 更新后 `meta.updated` 字段设为当天日期
- **微信文章等无法抓取的链接，直接询问用户标题和主题**
