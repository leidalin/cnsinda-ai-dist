# DL评论助手 — Chrome 扩展

**完整维护手册（必读）**：`..\..\03_需求与维护文档\DL评论助手_维护说明.md`
功能现状、平台踩坑、构建发布流程、历史变更、待开发事项全部在那里，本文件只做开发速查。

## 技术栈

- 构建：Vite + esbuild　UI：Vue 3 + Element Plus + TypeScript
- 存储：IndexedDB（`AICommentCounter`）+ `chrome.storage`
- 运行时：Chrome Manifest V3

## 常用命令

```bash
npm install

npm run build           # 开发构建，输出 dist/（Chrome 实际加载的就是这个目录）
npm run dev             # watch 模式
npm run build:release   # 正式发布，输出 release-dist/ 并自动同步到 01_客户使用\浏览器插件
```

发布前必须做类型检查：

```powershell
.\node_modules\.bin\vue-tsc.cmd --noEmit
```

> 注意：`build:release` **不会**同步 `dist/`，而 Chrome 加载的正是 `dist/`。
> 构建后需要手动把 `release-dist` 镜像到 `dist`，并删掉 `dist` 中已不在产物内的历史哈希文件。
> 详见维护手册第八章。

## 项目结构

```
src/
├── popup/       # 工具栏弹窗
├── dashboard/   # 主界面（评论管理 / 截图存档 / 系统设置）
├── options/     # 设置页
├── content/     # 内容脚本：平台识别、扫描、互动、截图
├── background/  # Service Worker：任务队列、AI 请求、备份、日志
├── db/          # IndexedDB
└── shared/      # 平台识别、账号、共享类型
scripts/         # 构建脚本（build-release.js 含发布前合规校验）
```
