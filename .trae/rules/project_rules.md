# 项目规范

## 技术栈

- 纯静态 HTML/CSS/JS，无框架
- GitHub Pages 托管
- Font Awesome 6.5.2 (CDN)
- highlight.js (CDN)

## 代码规范

### HTML

- 使用 `lang="zh-CN"` 声明语言
- 主题通过 `<html data-theme="dark|light">` 控制
- 内联 `<style>` 放在 `<head>` 中，`<script>` 放在 `<body>` 末尾
- 图片使用 `loading="lazy"` 懒加载

### CSS

- 使用 CSS 变量（`--bg-0`, `--bg-1`, `--ink`, `--cyan` 等）
- 深色/浅色主题通过 `[data-theme="light"]` 选择器覆盖
- 响应式断点：1024px / 768px / 680px / 420px
- 毛玻璃效果：`backdrop-filter: blur()`
- 渐变文字：`-webkit-background-clip: text; color: transparent`

### JavaScript

- 使用 ES5 兼容语法（`var` / `function` 声明），兼容旧浏览器
- 主题切换通过 `localStorage` 持久化
- 滚动动画使用 `IntersectionObserver`
- 全局变量 `hljs` 为只读外部依赖

## 命名规范

- CSS 类名使用 kebab-case（如 `nav-links`, `hero-badge`）
- HTML 文件命名使用小写 + 连字符（如 `wx-b300-hardware.html`）
- 图片资源放在对应页面目录下

## 开发命令

- `npm run dev` — 启动本地开发服务器 (port 5500)
- `npm run lint` — JS 代码检查
- `npm run lint:fix` — JS 代码自动修复
- `npm run format` — 格式化所有代码
- `npm run lint:css` — CSS 代码检查
- `npm run check` — 运行全部检查

## 注意事项

- 不要修改 `node_modules` 目录
- 不要提交 `.env` 等敏感文件
- 文章内容中的图片使用 CDN 外链，不存本地
- 抖音搬运文章的视频使用抖音官方 aweme/v1/play 接口
