# DL评论助手 · 维护说明（唯一文档）

> 接手、改代码、发布前只看这一份：功能现状 + 维护规则 + 历史踩坑 + 变更记录。
> 当前版本 **2.0.3**　最后更新 **2026-10-20**

---

## 一、项目定位与架构

- 正式名称：**DL评论助手**，形态：**纯 Chrome Manifest V3 扩展**。用户在 `chrome://extensions` 加载插件目录即可使用。
- **不存在**客户端、EXE、BAT、Electron、Native Messaging、本地服务、注册表或扩展 ID 注册流程，后续维护不允许重新引入。
- AI Key、任务状态、模板与日志存 `chrome.storage.local`；扫描记录与截图存 IndexedDB `AICommentCounter`。

### 关键目录

| 路径 | 说明 |
| --- | --- |
| `02_完整源码\插件源码` | **唯一正式源码与构建工程**，所有修改只在这里进行 |
| `02_完整源码\插件源码\dist` | **用户 Chrome 中实际加载的运行目录**，每次构建后必须手动同步 |
| `02_完整源码\插件源码\release-dist` | 正式构建输出（压缩、剔除调试代码与残留资源） |
| `01_客户使用\浏览器插件` | 客户交付成品目录，必须与 `release-dist` 完全一致 |
| `01_客户使用\V2_客户安装与使用说明.md` | 发给客户的安装说明 |
| `DL评论助手_V2_客户使用_最终版.zip` | 客户交付包（zip 根目录直接是插件文件，不套一层文件夹） |
| `SHA256SUMS.txt` | 交付包校验值 |
| `03_需求与维护文档` | 本文件（唯一） |

### 主要代码入口

| 文件 | 职责 |
| --- | --- |
| `src/background/index.ts` | 后台消息路由、批量任务、标签页控制、受信任输入兜底、在线核验、截图会话编排 |
| `src/background/local-client.ts` | AI 请求、AIProxy 接入、Key 管理、加密备份、客户端日志、任务状态 |
| `src/content/index.ts` | 平台检测、登录/风控判定、扫描调度、结果回传、浮窗通知 |
| `src/content/actions.ts` | 评论、点赞、收藏通用动作与平台分流 |
| `src/content/{csdn,zhihu,toutiao,baijiahao,netease,sohu}.ts` | 各平台扫描 |
| `src/content/evidence.ts` | 评论区打开、账号匹配、逐条定位与截图 |
| `src/db/index.ts` | IndexedDB 结构与记录读写 |
| `src/shared/{platform,account,types}.ts` | 平台识别与 URL 规范化、账号配置、共享类型 |
| `src/dashboard/App.vue` | 全部界面：评论管理、截图存档、系统设置 |

---

## 二、支持范围

正式支持 **6 个平台**：CSDN、知乎、今日头条、百家号、网易、搜狐。

- 其余合法 HTTP/HTTPS 链接记录为 **“第三方平台（等待开发）”**（`third_party`），参与汇总/复制/导出，但**不打开页面、不扫描、不互动**。
- 今日头条同时识别 `/article/{id}` 与 `/item/{id}`。
- 网易跟贴页 `comment.tie.163.com/<编号>.html` 属于同一篇文章任务，不能当“非文章页”拦截；**归档与记录始终用原文章 URL**。

---

## 三、功能清单

**检测与记录**

- 粘贴 URL（每行一个）自动去重、按平台分类，第三方链接也持久记录。
- 批量检测支持停止，每条完成立即回传评论数、点赞、收藏、账号与失败状态。
- 同一平台 + 规范化 URL **只保留一条最新记录**（规范化去掉查询参数与锚点）。
- 评论数**允许下降**（平台删评论后以最新为准），不得用旧缓存顶替。
- 低于警戒线标红并可导出；支持单条重检、按不足项检测、重检全部、一键清空。
- “刷新列表”只读本地；“重新扫描”才访问网页。
- 批量检测最多**双并发**，启动间隔**至少 2500ms**。

**互动（点赞 / 收藏 / 评论）**

- 三个动作**相互独立**，各自记录进度，互不覆盖。
- 操作前校验登录态与账号；未登录、账号未知/不一致、出现验证码或风控时**立即停止**，不绕过平台验证。
- 每链接每轮**最多发一条评论**，发布后必须重新扫描确认；未确认禁止再次发布。
- **本轮已经点过“发表”的链接，复扫数量没同步时禁止自动重复补发**（只补点赞/收藏并提示人工确认）。复扫数量落后于页面（接口同步慢、账号昵称识别偏差）时再次补发就是刷屏评论，见 2026-10-16 的百家号事故。
- 禁止无人值守无限循环，下一轮必须用户手动开始。
- 网易**不做文章级点赞与收藏**，只统计评论。
- 评论来源二选一且不混用：`AI 评论` 或 `无 Key 模板`（≤500 条，英文分号 `;` 分隔，顺序轮换/随机抽取）。

**评论截图存档**

- 评论复检成功且本账号评论数增加时自动截该条新评论；也可在截图存档页手动逐条截图。
- 平台分类 Tab + 按链接分组卡片 + 标题/URL 搜索 + 大图预览 + 单张下载 + 选择/一键导出 ZIP（纯前端 UTF-8 ZIP，`平台名称/文章标题/图片.png`，中文不乱码）。

**配置与日志**

- 六平台昵称可手动配置并**优先于页面自动识别**；与自动识别不一致时按手填统计并记录告警。
- AI 服务商：DeepSeek / OpenAI / 通义千问 / Kimi / 智谱 GLM / Anthropic Claude / Google Gemini / 硅基流动 / 自定义兼容接口，以及本机 `.aiproxy_sxd/config.json` 一键接入（AIProxy Claude / Codex）。
- AI Key 不回显、不进文章页、不进日志；AIProxy 临时凭据只写 `chrome.storage.session`。
- 配置备份：PBKDF2-SHA256 210000 次 + AES-256-GCM，密码 ≥8 位，导出 `.dlconfig`。
- **诊断日志**：系统设置页可一键导出 `DL评论助手诊断日志_*.json`，含环境信息、配置快照、**全部链接检测记录**、界面运行日志、后台操作/问题日志、账号探测日志与计数；另有 TXT 流水、复制摘要、刷新、清空。导入/检测/点赞/收藏/评论/截图/配置每一步都留日志。
- 日志中**禁止**出现 API Key、Cookie、Authorization、备份密码、卡密明文与文章正文。

**已下线**：消耗点、余额、充值、卡密、离线授权。不得用本地存储、机器码或离线签名恢复（见第九章）。

---

## 四、平台实现要点与历史踩坑

> 原则：**一个平台异常只改该平台分支，不要重写通用扫描或所有平台的选择器。**

**CSDN**

- 评论入口新版 `a.tool-item-href.go-side-comment`，旧版 `a.has-comment-bt-right.go-side-comment` 保留兼容。
- 操作窗口必须**桌面宽度 1100px**（760px 会触发响应式隐藏评论工具栏）。
- 先开侧栏再反复点 `.look-more-comment`，最后还要点 `.look-flod-comment` 进折叠区。
- 收藏真实状态看子图标（`.un-collect-status.isdefault` 隐藏、`.collect-status.isactive` 显示），**不能只看外层 `un-collection`**。
- 404 页可能残留旧接口数据，必须优先判断页面失效。
- 接口统计用稳定账号 ID，界面匹配用真实昵称，账号动态读取，禁止写死。

**知乎**

- 新版可能先渲染 Draft.js 编辑器、点击后才挂载发布按钮；流程必须允许“编辑器在、按钮暂不在”，先真实点击编辑器再等按钮。不要删 `prepareZhihuEditor` / `readZhihuControls` / `operateZhihuSubmitButton` 里的真实点击与防重复逻辑。
- 收藏状态可能用 `aria-pressed`、`aria-label=已收藏/取消收藏` 或 active class 表达，不能只匹配一种。
- 弹层/fixed 元素 `offsetParent` 可能为 null，**不能据此判断不可见**。
- 存档截图先点底部“点击查看全部评论”打开 `.Modal-content`，节点用 `div[data-id]`、正文 `.CommentContent`，作者靠账号主页链接匹配，不依赖动态 `css-*` 类名。

**今日头条**

- 评论面板可能是右侧抽屉（`.ttp-drawer` / `role="dialog" aria-label="评论"` / `.ttp-portal-wrapper.ttp-comment-drawer`），也可能是正文内嵌 `.comment-textarea`；优先用已可见的正文输入框。
- 必须真实 focus + 输入事件 + 页面自身编辑流程，直接写 DOM 常导致发布按钮不激活。
- 发布按钮由 `disable` 变可用，发布后必须重新扫描确认。

**百家号**

- 新版直接渲染 `textarea[placeholder="发表神评妙论"]`，不再保证有 `[data-testid="comment-btn"]`。
- **账号识别必须过滤站点导航文案**（`NON_ACCOUNT_TEXT` / `NON_ACCOUNT_KEYWORD`：登录、注册、到百度首页、个人中心、消息、下载、客户端……）。页面顶部导航链接的文本若被当成当前登录账号用于匹配评论作者，**本账号评论数会恒为 0**，补齐会误判“没评论成功”并反复发布重复评论（2026-10-16 事故：单篇被连发 6 条）。
- 自动识别不到账号时，用**手动配置的昵称**作为别名传给 `resolvePlatformUsername`，否则会记成“账号未知”而把补齐误判为未登录直接暂停。
- 作者昵称有后缀差异（“大叔的温柔”vs“大叔的温柔i”），必须用容差匹配 `isAuthorMatched`（忽略大小写、允许末尾 1~3 位字母数字）；账号一致性判定同理走 `isSameAccountName`，不能直接用全等。
- 点赞/收藏状态在按钮 class、`aria-pressed` 或 active 图片 URL 中，需多信号判断。
- 评论可达 40~50 条，需点 `.xcp-list-loader` 加载后续（`findLoadMoreButton` 支持 `:not(.no-more)`）。
- 百度通行证异步占位会短暂显示“登录”，登录检测必须防抖复检，避免误报未登录。
- 发布兜底：整段输入不完整时全选清空后逐字输入兜底，内容不一致时禁止点发表。

**网易**

- **2026-10-16 起改为接口通道**：从地址末段取 thread id，三级解析 product Key（页面已发生的 `comment.api.163.com` 请求 → 页面内联 `productKey` → 内置默认值 `a2869674571f77b5a0867c3d71db5856`），直接调
  `https://comment.api.163.com/api/v1/products/<key>/threads/<tid>/comments/newList|hotList`。
- **背景**：评论区改为**滚动懒加载**，后台（未激活）标签页永远不会触发 `newList` 请求，旧版“从 `performance` 里找 `newList/hotList` 模板”的写法**恒定失败**（报“未发现网易评论接口”）。新写法不再依赖页面渲染评论区。
- 该接口**无需登录 Cookie** 即可读公开评论；扫描仍要求配置或识别到本人昵称。
- 登录态只认**评论区自身控件**（`#tieArea .submit-btn` 文本“登录并发贴”、`#tieArea a[href*="reg.163.com"]`），**不要把页头站点级“登录/注册”当未登录**。
- 昵称比对前去掉 `[网易xx手机网友]` 尾巴，避免同一账号算成两个名字。
- `hotList`/`newList` 会重叠，按 `postId` 去重；`del/isDel` 跳过。
- 不做文章级点赞/收藏。截图走 `comment.tie.163.com/<编号>.html` 完整跟贴页（根跟贴 `.list-bdy > .trunk`、参与回复 `.floor .self`），分页 `.m-page .next.z-enable` 后**必须等列表签名真实变化**（最长 6 秒），不能只固定 sleep。

**搜狐**

- 已改版为自定义组件 + REST 接口：评论走 `/wap/api/comments/pages`，登录态走 `/comment/api/user` 直读。
- `/comments/load` 传 `page_no=2` **不会翻页**而是重复返回第 1 页，**只有 `/comments/pages` 能正确翻页**（“3 条漏 1 条报 2 条”的根因）。
- 后台标签页中 `position: fixed` 容器内子元素 `offsetParent` 恒为 null，不能据此判断不可见。
- DOM 扫描仅作 API 受阻时的兜底。

**通用**

- 不要把文章作者、他人评论或占位昵称当成当前账号。
- 账号一致性判定统一走 `shared/account.ts` 的 `isSameAccountName`（容忍末尾 1~3 位字母数字后缀），不要再直接用全等比较，否则本人会被判成“账号不一致”而中断任务。
- 知乎、头条、百家号评论必须**临时激活文章标签页**执行，完成后自动关闭并恢复用户原页面；**禁止改回非聚焦独立窗口**（编辑器不挂载、输入被忽略或中文只输入一部分）。
- 不要用 `element.value = text` 代替受信任输入。
- 明确读到 false 才允许把点赞/收藏更新为 false；无法确认时返回未知，不得覆盖已确认的历史状态。

---

## 五、必须保持的技术约束

- IndexedDB 名称固定 `AICommentCounter`、对象仓库 `comments`，改名旧记录不可见。
- manifest 不随意新增固定 key，扩展标识变化会被 Chrome 视为另一份插件。
- 客户目录不得出现源码、Source Map、`node_modules`、EXE、BAT、安装脚本；manifest 不得含 `nativeMessaging`。
- `debugger` 权限是今日头条受信任输入所必需，但发布版脚本中**不允许出现 `console.` 或 `debugger;`**（构建脚本强制校验）。
- 存储键：账号在 `storage.sync/usernames`；模板、评论模式、警戒线、日志在 `storage.local`。

---

## 六、评论截图存档规则

- 触发：`commentPosted === true` **且**复检后本账号评论数高于发布前；点赞/收藏不产生截图。
- 数据：WebP 存 IndexedDB `commentEvidence`（保存前算 SHA-256）；每链接最新汇总存 `commentScreenshotArchiveRuns`；批次历史存 `commentScreenshotArchiveRunHistory`（≤3000）。
- 去重键：优先平台评论 ID；无 ID 用“账号+评论文字+平台时间”，同列表重复内容保留 `:copy:N`。键内含格式版本（当前 `viewport-v2`）。
- 截图统一 `captureBeyondViewport: false` 当前视口模式（`true + clip` 会超时），保留文章与前后评论上下文。
- 目标评论必须**同时**在浏览器视口与评论滚动容器内才可截图；定位失败不得立刻标记已处理，需多阶段居中滚动 + 多轮重试。
- 完整性：`missingCount = max(0, detected - captured)`；只有检测数 = 当前对应截图数且无失败才可显示“截图完整”，否则必须显示“缺少 N 条”。
- 截图只是**采集时刻页面记录**，不是公证/可信时间戳/平台后台证明；已删除、折叠、权限受限的评论无法补拍。
- 删除：单张删除或扫描记录“一键清空”才删图片；清空评论历史只解除关联。`source` 区分 `automatic_comment` / `manual_scan`。
- 在线核验：`present`（仍能定位到相同评论文字）/ `suspected_deleted`（文章失效或本账号评论数低于存档时）/ `unknown`。

---

## 七、大模型与 AIProxy

- 协议自动识别：Chat Completions、Responses、Anthropic Messages、Gemini；自定义地址按 URL 判定并补全路径。
- 推理模型（GLM 5.x / Kimi / Moonshot / 网关转发）依次尝试 `thinking: disabled`、`enable_thinking: false`、`reasoning_effort: none`、`chat_template_kwargs.enable_thinking: false`，接口拒绝则跳过；**只取最终 `content`，绝不把推理过程当评论**。
- 预设模型不写死，Key 填好后调 `/models` 取账号真实可用模型。
- GPT-5 / O 系列优先 `max_completion_tokens` 且不发不兼容的 `temperature`，参数不兼容自动回退。
- 切换服务商不复用上一个 Key；测试失败把 400/401/403/404/429/5xx/网络错误转中文原因。
- AIProxy：用户选一次 `.aiproxy_sxd/config.json`，自动读网关、临时 session key 与模型组；Claude 走 `/v1/messages`，Codex 走 `/v1/responses`；未明确网关时回退 `http://192.168.60.2:8084`。浏览器重启或 session 轮换后需重新选文件。
- 后台 `CLIENT_COMMANDS` 是独立白名单，新增命令必须同步加入，否则报“不允许的插件命令”。

---

## 八、构建与发布流程

> 只在 `02_完整源码\插件源码` 改源码；改完必须走完整流程，不能直接改客户目录或 `dist`。

```powershell
cd "G:\常用文件\ai写的exe\已经完成的检测批量插件chrome_V2\02_完整源码\插件源码"

# 1. 类型检查（必须 0 错误）
.\node_modules\.bin\vue-tsc.cmd --noEmit

# 2. 正式构建（输出 release-dist，并自动同步到 01_客户使用\浏览器插件）
npm.cmd run build:release
```

3. 若提示 `旧 release-dist 目录未能清理`：Windows 文件句柄延迟释放的已知问题——把 `release-dist` 移到备份目录后重跑（**只动构建残留，不要碰客户数据目录**）。
4. **手动把 `release-dist` 镜像到 `dist`**（构建脚本不同步 `dist`，而 Chrome 加载的就是它）：
   - 复制全部文件覆盖；
   - **删除 `dist` 中不在 `release-dist` 里的文件**（历史哈希资源会累积，曾从 27 个涨到 56 个，交付包因此从 ~500KB 涨到 2.1MB）。
   - 同样清理 `01_客户使用\浏览器插件`（构建脚本的 xcopy 不删除 `assets/` 内旧文件）。
5. 校验 `dist`、`release-dist`、`01_客户使用\浏览器插件` 三者完全一致。
6. 重新打包交付包（zip 根目录直接是插件文件）并更新 `SHA256SUMS.txt`。
7. 发布前自检：客户目录无 `.map/.ts/.tsx/.vue`；manifest 无 `nativeMessaging`；`content/*.js` 与 `background.js` 无 `console.` / `debugger;`；确认是否需递增版本号。

### 发布后验证顺序

先用一个 CSDN 链接验证评论入口与发布确认，再验证知乎编辑器点击发布、网易文章页扫描；之后测批量检测、点赞收藏与截图存档。

---

## 九、待开发：服务端点数功能

当前完全下线，**不得**用本地存储或离线签名恢复。若恢复必须解决：卸载重装不能重复领点、同一卡密不能多机兑换、任务重试不能重复扣费、插件被改不能伪造余额。

推荐服务端模型：`users`、`installations`（风控）、`wallets`（只由服务端事务改）、`wallet_ledger`（不可变流水）、`redeem_codes`（存哈希、唯一约束原子兑换）、`billing_tasks`（任务 ID + 幂等键）。

计费：首赠用 `welcome_grant:<user_id>` 唯一键仅成功一次；扣费必须带服务端任务 ID，重复上报返回原结果；评论/点赞/收藏只在复检确认成功后上报，失败不扣；内部扫描与发布后复检不另计费。私钥、卡密生成器、数据库凭据只存在于服务端。

---

## 十、交接速查

1. 读完本文件（含下方变更记录）。
2. 确认 `dist`、`release-dist`、客户目录是否一致；不一致先对齐再动手。
3. 改代码前备份要改的文件。
4. 每次改动都要：`vue-tsc --noEmit` → `npm run build:release` → 同步 `dist` 与客户目录 → 重打包 zip → 更新 `SHA256SUMS.txt` → 在下方追加变更记录。
5. 用户报错时优先索取「系统设置 → 诊断日志与问题反馈 → 导出完整诊断日志」的 JSON。

---

## 十一、GitHub 仓库与远程同步

- 仓库（**已有，只更新，不要再建新仓库**）：`https://github.com/leidalin/cnsinda-ai-dist`，公开，GPL-3.0，默认分支 `main`
- 工作副本：`G:\常用文件\ai写的exe\_cnsinda_ai_dist_upload`（已带 `.git`，直接在这里更新后 push）

**仓库结构**

| 仓库路径 | 来源 |
| --- | --- |
| `01_客户使用/浏览器插件/`（27 个文件） | `02_完整源码\插件源码\release-dist` **镜像**（必须与 `dist`、客户目录一致，旧哈希文件要清掉） |
| `01_客户使用/V2_客户安装与使用说明.md` | 同名文件 |
| `02_完整源码/插件源码/` | `src` `scripts` `public` + `manifest.json` `package.json` `package-lock.json` `tsconfig.json` `vite.config.ts` `README.md` |
| `03_需求与维护文档/DL评论助手_维护说明.md` | 本文件 |
| `DL评论助手_V2_客户使用_最终版.zip` + `.sha256` | 客户交付包与校验值 |
| `版本信息.json` | 版本 / 构建日期 / 包名 / SHA256 / 平台清单 |
| `README.md`、`LICENSE`、`.gitignore` | 仓库自维护 |

**不进仓库**：`node_modules`、`release-dist`、`_backup_*`、`*.zip.backup-*`、`*.bak.*`、`*.orig`、`.aiproxy_sxd/`、`*.dlconfig`、`.env`（见 `.gitignore`）。**交付 zip 本身要提交**，所以不要写 `*.zip` 通配。

**更新到 GitHub（发版后执行）**

```powershell
$SRC  = "G:\常用文件\ai写的exe\已经完成的检测批量插件chrome_V2"
$REPO = "G:\常用文件\ai写的exe\_cnsinda_ai_dist_upload"
cd $REPO; git pull --ff-only

# 1. 插件产物（先清空再镜像，避免历史哈希文件残留）
Remove-Item "$REPO\01_客户使用\浏览器插件\*" -Recurse -Force
robocopy "$SRC\02_完整源码\插件源码\release-dist" "$REPO\01_客户使用\浏览器插件" /E

# 2. 源码
robocopy "$SRC\02_完整源码\插件源码" "$REPO\02_完整源码\插件源码" /MIR /XD node_modules release-dist dist _backup_*

# 3. 交付包 / 说明 / 文档 / 版本信息
Copy-Item "$SRC\DL评论助手_V2_客户使用_最终版.zip" $REPO -Force
(Get-FileHash "$REPO\DL评论助手_V2_客户使用_最终版.zip" -Algorithm SHA256).Hash.ToLower() +
  "  DL评论助手_V2_客户使用_最终版.zip" | Set-Content "$REPO\DL评论助手_V2_客户使用_最终版.zip.sha256"
Copy-Item "$SRC\01_客户使用\V2_客户安装与使用说明.md" "$REPO\01_客户使用" -Force
Copy-Item "$SRC\03_需求与维护文档\DL评论助手_维护说明.md" "$REPO\03_需求与维护文档" -Force
# 手工更新 版本信息.json 的 version / buildDate / sha256，README 的版本与修复摘要

# 4. 提交推送
git add -A
git status --short      # 确认没有 node_modules / *.bak / _backup 混入
git commit -m "更新至 vX.Y.Z：<一句话摘要>"
git push
```

**凭据**：`gh` 已装在 `C:\Users\Administrator\AppData\Local\gh\bin\gh.exe`，账号 `leidalin`（显示名 `DL-cn`），device-flow OAuth（scope `repo`、`workflow`），token 存于 `%APPDATA%\GitHub CLI\hosts.yml`，`gh auth setup-git` 已接管 git 凭据。缺失 `read:org` 不影响本仓库操作。若客户端里 push 仍要密码，检查 `git config --global --get-regexp credential` 里是否残留 `helper-selector`。

**注意**：这个仓库公开，任何被写进源码/文档的内网地址、账号密码、Key 都会公开。历史上曾误建过私有仓库 `leidalin/DL-comment-helper`（内容是本仓库的子集），已弃用，不要再往那里推。

---

# 变更记录

## 2026-10-20　代码上 GitHub + 客户目录残留清理

1. **更新已有仓库** `leidalin/cnsinda-ai-dist`（公开，GPL-3.0）至 **v2.0.3**：`01_客户使用/浏览器插件` 换成新产物（27 个文件，旧哈希文件已清）、交付 zip 与 `.sha256` 更新、`版本信息.json` 改为 2.0.3 / 2026-10-20；**新增** `02_完整源码/插件源码`（源码 + 构建工程）与 `03_需求与维护文档/DL评论助手_维护说明.md`；README 补源码/文档入口与 2.0.3 修复摘要；新增 `.gitignore`。仓库共 75 个文件，同步步骤见第十一章。
2. **交付包校验**：zip 505,137 字节，SHA256 `96662b0a6d8a02544996c18b0dd8209922f9f07dc87a5511faead53928d34da3`，与 `SHA256SUMS.txt`、`版本信息.json`、仓库内 `.sha256` 四处一致（已从远端下载回校验）。
3. **清掉 10-16 遗留待办**：删除 `01_客户使用\浏览器插件\assets\` 下 4 个无引用的历史哈希文件（`dashboard-Cls8zRJR.js`、`dashboard-lnQwee-z.css`、`evidence-NVFe9YMf.js`、`index-BxSlOgMd.js`）。已核对 HTML 引用表，无一被 `src/*.html` 引用；现 `dist`、`release-dist`、`01_客户使用\浏览器插件` 三者完全一致（各 27 个文件）。
4. **发布前自检复验通过**：`dist` 内无 `console.` / `debugger;`、无 `.map/.ts/.vue`、`manifest.json` 无 `nativeMessaging`、`content_scripts` 覆盖 6 个平台、源码无硬编码 Key。
5. **已知遗留**：`src/background/local-client.ts:223` 仍是内网网关默认回退值 `http://192.168.60.2:8084`。仓库 `cnsinda-ai-dist` 是**公开**的，该地址已随源码公开——它只是 AIProxy 未指定网关时的兜底值，不含任何凭据。如介意，改为占位符后需重新 `build:release` 并同步三处产物。

## 2026-10-16（下午）　百家号重复评论事故

用户反馈：百家号评论完了，但第二次检测还是 0，导致补齐重复判定为“没评上”并反复补发评论（诊断日志 `DL评论助手诊断日志_2026-10-16_0747.json`）。

日志证据：`SAVE_SCAN_RESULT` 里 `commentCount: 0` 而 `totalCommentCount` 从 4 → 7 → 10 一路增长（评论确实发出去了），同一篇文章被连发 2 轮共 6 条；手动配置昵称后重新检测立刻变成 `匹配到:6条`。

1. **根因：百家号账号识别抓到了站点导航文案。** 用户当时没填百家号昵称，`detectCurrentUsername` 把页面顶部的“到百度首页”链接文本当成当前账号，`resolvePlatformUsername` 据此返回 `到百度首页`，用它去匹配评论作者自然恒为 0 → 补齐先判“本账号 0 条”发 3 条，复扫又是 0 → 再发 3 条。已新增 `isPlausibleAccountName`（关键词 + 固定文案黑名单），并在自动识别不到账号时把手动配置昵称作为别名兜底（避免被判“账号未知”而暂停补齐）。
2. **安全网：本链接本轮点过“发表”就不再自动补发评论。** `runSupplement()` 的统一复扫补做阶段原本只看 `commentCount` 是否达标，不看本轮是否已经发过。现在对 `results` 里 `commentPosted` 的链接只补点赞/收藏，评论缺项改为写 `supplement-comment-retry-skipped` 日志并在进度条提示“本轮已发表评论，复扫数量暂未同步；已跳过重复发布”。这条对搜狐 `COMMENT_PENDING_CONFIRMATION` 的链接同样生效。
3. **账号一致性判定放宽到后缀容差**：`shared/account.ts` 新增 `isSameAccountName`（全等 / 忽略大小写 / 允许末尾 1~3 位字母数字后缀）与 `getConfiguredUsername`；`resolvePlatformUsername` 的“手动账号与自动识别不一致”判定改用它，避免“大叔的温柔”vs“大叔的温柔i”被判成账号不一致而中断任务。
4. **产物**：`release-dist` / `dist` / `01_客户使用\浏览器插件` 已对齐（27 个文件）；交付包从 `release-dist` 重打包（505,137 字节，SHA256 `96662b0a…d34da3`）并更新 `SHA256SUMS.txt`；旧包备份为 `DL评论助手_V2_客户使用_最终版.zip.backup-20261016`。版本号仍为 **2.0.3**（本次未递增）。
5. **待办**：`01_客户使用\浏览器插件\assets\` 下 4 个历史哈希文件（`dashboard-Cls8zRJR.js`、`dashboard-lnQwee-z.css`、`evidence-NVFe9YMf.js`、`index-BxSlOgMd.js`）本次无权限删除，需手工清理；本次交付包已从 `release-dist` 直接打包，不含这 4 个文件。

## 2026-10-16　导入检测失效 / 网易检测 / 诊断日志

用户反馈：①「导入并快速检测」点击无效 ②网易链接检测失效（几乎每月都要修）③缺详细日志无法报错，希望系统设置能导出。

1. **「导入并快速检测」失效**：模板绑定的 `importAndStartDetection` 在脚本里**根本没有定义**（10-09 改版改了函数名只留模板引用），点击无反应。已新增该函数：先落库再检测。`startBatch()` 改为可接收分类结果，**必须先按导入前的分类结果启动检测**——`importUrlsOnly` 会清空输入框，清空后分类集合为空会导致检测无目标。已全量扫描模板引用，确认仅此一处漏网。
2. **网易检测重构**（根因见第四章“网易”）：`netease.ts` 改为接口通道，不再依赖页面渲染评论区；修正登录误判；返回结构化诊断。`content/index.ts` 记录各平台抛出的具体原因，失败时返回 `扫描失败：<原因>` 而非笼统的“扫描无结果”。
3. **系统设置新增「诊断日志与问题反馈」**：一键导出完整 JSON（环境 + 配置快照 + 全部链接记录 + 三类日志 + 计数），另有 TXT 流水、复制摘要、刷新、清空。补齐此前缺失的操作日志（一键点赞收藏/评论/流水线/批量检测开始/配置导出恢复/批量删除），并修复 `loadClientLogs` 定义了却从未调用的问题。
4. **顺带修复**：`handleDeleteSelected` 调用了**不存在的** `saveRecordsToStorage()`（历史遗留，类型检查报 `TS2304`），表现为批量删除抛异常且只改内存不删库；改为逐条 `deleteRecord()`。修复后 `vue-tsc` 恢复 0 错误。
5. **产物清理**：`dist` 与客户目录累积了 **29 个历史哈希资源**，已移出到 `插件源码\_backup_20261016\`，两者与 `release-dist` 完全一致（27 个文件）；交付包重打包（503,420 字节）并更新 `SHA256SUMS.txt`。
6. **文档精简**：`03_需求与维护文档` 由 13 份合并为本文件，历史文档移入 `插件源码\_backup_20261016\docs\`。

## 2026-10-09　界面改版与截图存档增强

- 侧边栏精简为 **评论管理 / 截图存档 / 系统设置**；核心操作外显为 `★ 一键点赞+收藏`、`💬 一键评论`、`⚡ 全自动流水线`，其余收进“更多操作”。
- 视觉改为政务规范色（深蓝 `#1e3a8a`、浅灰蓝 `#f1f5f9`），统一 1px 实线边框与 3px 直角微弧，去渐变与阴影。
- 截图存档：平台分类 Tab、按链接分组卡片、相册网格大图预览、标题/URL 搜索、选择导出与一键导出 ZIP。
- 期间用户曾要求回退到 09-28 基准包（“现在改的都是问题”）。
- **遗留教训**：本轮把 `importAndStartDetection` 的实现删了却留了模板引用（10-16 才修）；文档记录的 zip 体积/哈希与实际产物不符（实际根目录包一直含历史残留，2.1MB）。

## 2026-09-28　搜狐与百家号检测修复 + 全链路诊断

- **搜狐**：报 0 的根因是翻页接口用错（`/comments/load` 传 `page_no=2` 只会重复返回第 1 页，必须用 `/wap/api/comments/pages`）＋后台标签页 `fixed` 容器 `offsetParent === null` 被误判不可见。改为 API 极速通道 + 登录态接口直读，DOM 仅兜底。
- **百家号**：报 0 的根因是昵称严格全等（实际“大叔的温柔i”vs 配置“大叔的温柔”）。新增容差匹配 `isAuthorMatched`，并加 background 直连官方评论接口通道。
- 新增 `diagnostics` 诊断串（声明数/载入数/配置账号/探测账号/匹配数），界面高亮并随流水导出；操作流水上限 300 → 2000。

## 2026-09-21　界面极简重构与四大一键操作

- 6 个 Tab 收敛为 3 个视窗；去图表改指标卡；新增四大一键操作与实时日志控制台。
- 全自动流水线在单标签页生命周期内连贯完成“检测→点赞→收藏→评论→截图”，耗时缩短 70%+。
- `clickAndConfirm` 轮询 450ms → 150ms；评论发布后校验改为每 300ms 主动探测。

## 2026-09-20　搜狐互动识别与扫描提速

- 修复搜狐点赞/收藏偶发未知：`visible()` 补 `offsetWidth/offsetHeight/getClientRects()` 容错，扩充选择器，综合子节点类名与 `aria-*` 判断。
- 搜狐扫描 100+ 秒 → 2.5 秒内（按声明评论数快速探测）。
- 扫描记录工具栏改双行排版，修复窄屏“清空全部记录”被遮挡；`build-release.js` 增加 `rmSync` 重试。

## 2026-08-28　AIProxy 接入与多平台兼容

- 新增 `AIProxy Claude` / `AIProxy Codex`：选择一次 `.aiproxy_sxd/config.json` 自动读网关与临时 session key；凭据只存 `storage.session`。
- 修复新命令未加入 `CLIENT_COMMANDS` 白名单导致的“不允许的插件命令”。
- 自定义 OpenAI 兼容接口：自动请求 `/models` 取真实模型并规范化 `/chat/completions`；兼容智谱 Anthropic 兼容地址 → `/v1/messages`。
- 推理兼容扩展到 GLM 5.x / Kimi / Moonshot，只取最终 `content`。
- 修复 CSDN 新版评论入口、CSDN 后台窗口宽度（760→1100px）、百家号/CSDN 发布兜底、搜狐与 CSDN 评论误判、连续补齐按钮被缓存状态永久禁用。

## 2026-08-24　控件兼容、连续补齐与截图稳定

- 百家号优先用已渲染输入框；知乎先真实点击现有 Draft.js 编辑器；头条先滚入视口再受信任点击。
- 智能补齐改为**连续补齐**（按“目标数-当前数”逐条，随机间隔 1.5~4 秒），风控/未确认时停止该文章剩余次数。
- 后台任务改用独立小型操作窗口，不再依赖用户当前标签页；截图定位后禁动画、等两帧 + 650ms 再截取完整视口。**不启用桌面采集**。
- 新增“按不足项扫描”（只重检状态，不自动互动）。

## 2026-08-21　搜狐平台适配

- 搜狐 `/a/<文章ID>_<作者ID>` 独立识别，不再与第三方共用旧 `sohu` 兼容值；评论/点赞/收藏/截图选择器落地；第三方记录用独立 `third_party` 类型。

## 2026-08-04　存档中心与逐条评论截图

- 存档从静态 HTML 快照改为**逐条评论截图**（WebP 88 + SHA-256，存 `commentEvidence`）。
- 五平台各自实现完整评论区打开、账号匹配、逐条定位与滚动；统一当前视口截图。
- 去重键含格式版本 `viewport-v2`；完整性用 `missingCount`，禁止把“只找到部分评论”标记为完整。
- 网易：先读原文章元数据再切完整跟贴页截图，翻页必须等列表签名变化（最长 6 秒）。
- 知乎新版弹窗：点“点击查看全部评论”开 `.Modal-content`，节点 `div[data-id]`，启动时先复位滚动到顶部。
- 无 Key 模式首次使用内置 10 条通用模板（仅存储键从未创建时注入）。

## 2026-07-31　V2 最终定版

- 完成 V2 最终验证并定版；正式客户包为纯插件，移除 Native Messaging、客户端 EXE、BAT、注册表与扩展 ID 授权。
- 知乎、头条、百家号评论改为**临时激活文章标签页**、结束后恢复原页面的稳定方案；非聚焦独立窗口方案永久下线。
- 保留头条 `/article/` 与 `/item/` 双格式、第三方链接持久记录、按动作分别回传结果、百家号完整输入校验、扫描记录与评论历史、加密配置备份、脱敏诊断日志。
- 完全下线消耗点、余额、充值、卡密（见第九章）。
