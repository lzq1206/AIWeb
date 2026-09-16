# AIWeb · Vibe Radar

一个专门收集 GitHub 上热门 AI 小功能与 Vibe Coding 项目的静态网站。

## 功能

- 瀑布流项目卡片：预览图、项目简介、分类、语言、星标和最近更新时间
- 搜索、分类筛选、最热 / 最新排序
- 点赞和收藏：保存在当前设备的浏览器中
- 评论：通过 Utterances 写入本仓库的 GitHub Issues，不需要把 Token 暴露给前端
- GitHub Actions 每天抓取两组搜索信号，每次最多新增 12 个项目
- 请求之间有节流、重试和退避逻辑，避免短时间大量请求触发 GitHub 限流
- GitHub Pages 自动部署：抓取 workflow 在同一次运行内完成数据提交和 Pages 发布

## 数据规则

`scripts/fetch_vibecodes.py` 只保留带有明确 AI 信号，并且同时具备 Vibe Coding 或具体工具 / 插件 / 编辑器 / 工作流等产品信号的仓库。项目会按星标、近期活跃度和 AI 关键词重新计算排序分数。

抓取任务通过 `data/fetch-state.json` 轮换搜索词，每日只处理两组查询；后续运行会逐步填充项目库，而不是一次性请求大量页面。

## 本地预览

在仓库根目录运行任意静态服务器，例如：

```bash
python -m http.server 4173
```

然后访问 <http://localhost:4173>。直接双击 `index.html` 时，浏览器会拦截 `data/projects.json` 的读取，因此建议使用静态服务器。
