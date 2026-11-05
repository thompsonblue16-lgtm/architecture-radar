# Architecture Radar / 建筑行业情报站

一款可自行部署、自动日更的建筑项目新闻聚合网站。中文界面，链接到英文/其他语言原文。**V3 新增：独立情报总览页面、手动检测更新、扩充媒体源及专题关键词。**

## 功能

- 建筑行业来源：8 路直接 RSS（ArchDaily、Dezeen、The Architect's Newspaper、designboom、Architectural Record 专题、ENR 及 ENR Midwest）+ 36 路 Google News 定向搜索（设计公布、批准、开工、竣工、招标、学校/医院/住宅/交通、全球地区、美国中西部、爱荷华州和多家重点建筑媒体）
- 自动抓取 RSS、按项目阶段与行业分类，过滤部分无关新闻，按 URL/标题去重
- 支持地区、项目阶段、全文关键词筛选；最近 7 天；按时间排序
- **基础模式**：收藏在当前浏览器，不同设备间不自动同步
- **多人协作模式（需配置 Supabase）**：邮箱登录、每个人的私密收藏跨设备同步、按邀请链接加入共享项目空间；项目清单/笔记供成员共享，但**私人收藏对他人完全不可见**
- **独立情报总览**：最新报道、项目进度、地区、建筑类型、14 天资讯趋势、媒体覆盖统计、16 家媒体入口
- **刷新新闻按钮**：从 `data/news.json` 无缓存重新读取已发布的数据，反馈新增文章数量和上次采集时间；**不会直接在静态网页内运行采集程序**
- 手机/电脑响应式布局；每条资讯跳转原始媒体
- **GitHub Actions 每天上午 8:20（America/Chicago）自动更新**，不依赖数据库、独立服务器或付费新闻 API
- 对失败的新闻源跳过并记录日志；只有全部来源失败才终止更新，保留前一次数据

## 最快捷部署（GitHub Pages）

你需要一个 GitHub 账号。GitHub Pages 用**公开仓库**托管这种静态网站通常是免费的。注意：公开仓库的代码和 `data/news.json` 都可被任何人看到，请勿放个人隐私、公司内部文件或 API 密钥。

1. 登录 [GitHub](https://github.com/new)，创建一个 **Public** 仓库，例如 `architecture-radar`，尽量不要勾选初始化 README（便于直接上传整套文件）。
2. 下载并解压本项目 ZIP，把**项目内部的所有文件和隐藏目录 `.github`** 放到该仓库的根目录。可用 GitHub 的 **Add file → Upload files**，上传前确认 `.github/workflows/update-news.yml` 一起被上传；某些网页上传方式会忽略隐藏目录，这时改用 Git。
3. 打开仓库 **Settings → Pages → Build and deployment**，选择 **Deploy from a branch**，Branch 选 `main`，Folder 选 `/ (root)`，保存。稍后会显示网站链接，例如 `https://你的GitHub用户名.github.io/architecture-radar/`。
4. 打开 **Actions → Daily Architecture News Update → Run workflow**，主动执行一次以抓取最新新闻。首次抓取需要访问互联网；网站自带的是 2026-11-05 的 **21 条已核对来源的初始精选新闻**，不是冒充自动抓取的结果。
5. 以后每天上午 **8:20 美国中部时间**（支持夏令时变化），GitHub Actions 会自动执行抓取，提交更新的 `data/news.json` 和 `data/news.js`，GitHub Pages 将自动部署新内容。GitHub 定时任务可能有延迟，不能保证精确到分钟。

**重要**：如果仓库开启了分支保护或限制 Actions 写入，需要在 Settings → Actions → General 设置对应权限，允许 `GITHUB_TOKEN` 写入仓库文件，或者将此工作流改用 Pull Request。

GitHub 对公共仓库若长期没有活动，可能停用计划工作流；出现这种情况可在 Actions 中重新启用。数据订阅源或其服务策略可能改变，必要时修改脚本中的 URL。

## 多人账号与共享项目空间（可选）

基础网站不依赖数据库。要使用 **B 方案：各自账号 + 各自私密收藏 + 共享项目清单**，请在完成 GitHub Pages 部署后执行以下步骤：

1. 在 [Supabase](https://supabase.com/dashboard) 创建一个项目。打开 **SQL Editor**，运行本项目 `supabase/schema.sql` 的完整内容。SQL 创建 `ar_favorites`（私密收藏）、`ar_workspaces`（共享空间）、`ar_members`（空间成员）、`ar_projects`（共享项目）及 Row Level Security 安全策略。
2. Supabase **Project Settings → API** 页面复制 **Project URL** 与 **publishable key / anon key**。将它们填入 `assets/config.js` 的 `url` 和 `anonKey`。**不能放 secret key、service_role 或数据库密码！** 前端 key 是公开的，数据保护依赖 RLS。
3. 在 **Authentication → URL Configuration** 将 `Site URL` 设置为 GitHub Pages 的实际网站地址，例如 `https://YOURNAME.github.io/architecture-radar/`，并添加允许的 **Redirect URLs**（包含这个网站的地址）。没有配置正确会导致邮箱登录跳到错误网站。
4. 在 **Authentication → Providers → Email** 启用邮箱认证（Magic Link / OTP）。**Supabase 默认邮件服务只能发送到项目团队预授权邮箱等有限地址；想邀请普通朋友，需要配置自己的 SMTP 邮件服务**，否则对方可能收不到登录邮件。参阅 [Supabase SMTP 文档](https://supabase.com/docs/guides/auth/auth-smtp)。
5. 提交 `assets/config.js` 到 GitHub 后，刷新网站，使用邮箱发送登录链接。首次登录自动注册；点邮箱中的链接回到网站。创建共享空间，复制邀请链接给朋友。朋友登录并打开邀请链接，即可加入空间。

### 权限与共享规则

- **私密收藏：** `ar_favorites` 按账号 ID 限制读/写/删除。不同账号无法互相查看收藏。收藏支持跨设备登录同步；退出账号时前端会清除缓存中的私人收藏。
- **共享项目：** 只有拥有共享空间成员资格的人能读取该空间下的项目。空间成员可以添加项目、修改状态、编辑笔记；创建者与空间所有者可以删除项目。
- **邀请：** 只有拿到有效随机邀请链接的人才能申请加入空间，加入前必须登录；邀请链接被转发也可能带来额外成员，空间所有者可更换链接使旧链接失效。链接更换不会自动移除已加入的成员。
- **新闻内容：** 公开可读，不需要登录。新闻来源与自动更新流程均与数据库无关。
- **目前不包含**：成员移除/离开空间、空间实时推送、管理员后台、邀请成员人数限制。项目列表可用“刷新列表”手动刷新，最多显示最新 250 个项目。

**注意**：以上是完成前端与数据库脚本的可部署版本；在你自己的 Supabase 项目填入配置、运行 SQL 并成功发送登录邮件之前，不能认为真实账号注册、RLS 隔离或邀请流程已经完成线上端到端测试。

## 本地预览

解压后双击 `index.html` 即可打开，`data/news.js` 使网站在不运行后端的情况下显示已有资讯。

如果想用本地服务，也可在文件夹根目录运行：

```bash
python -m http.server 8080
```

然后打开 `http://localhost:8080`。

本地手动抓取（需要网络）：

```bash
python scripts/update_news.py
```

本程序只用 Python 3.10+ 标准库，无需安装 pip 包；公开 RSS 访问速度可能受网络和站点策略影响。

## 调整资讯覆盖范围

编辑 `scripts/update_news.py`（现在 8 路直接 RSS + 36 路 Google News 定向检索，合计 44 路输入；**数量是配置数，不是每次实际成功数**）：

- `FEEDS`：新增其它 RSS/Atom 媒体地址。
- `GOOGLE_QUERIES`：加入项目关键词、城市、州或建筑公司关键词。例如 `"Iowa City" "new development" when:30d`。
- `MAX_AGE_DAYS`：保留历史资讯天数，默认 120 天。
- `MAX_ITEMS`：最多存储的文章数，默认 1800 条。
- `STAGES`, `SECTORS`, `IOWA`, `MIDWEST`, `US`：分类关键词配置。

修改抓取脚本并 push 到仓库也会自动触发一次更新。

## 文件组织

```text
index.html                        网站首页
assets/styles.css                 视觉风格与手机端适配
assets/app.js                     概览仪表盘、手动刷新、搜索、分类、收藏等交互
assets/config.js                  Supabase 前端公共配置（默认空）
assets/collab.js                  账号登录、私密收藏、共享空间与项目
supabase/schema.sql               Supabase 表及访问权限
data/news.json                    保存的新闻数据（人类和程序可读取）
data/news.js                      浏览器读取版本，随抓取同步生成
scripts/update_news.py            Python RSS/Atom 聚合脚本
.github/workflows/update-news.yml 定时任务配置
.nojekyll                          GitHub Pages 静态文件标记
```

## 限制与隐私说明

- **刷新按钮不是实时抓取器。** 如果 GitHub Actions 尚未运行、网页尚未重新部署、或者订阅本身暂时没有更新，点击刷新可能显示 0 条新增。部署后请先在 GitHub Actions 点击 `Run workflow` 测试真实更新。
- **不会真的覆盖全互联网的所有建筑新闻**，只覆盖已设置的媒体和关键词，可能漏报或出现误分类。项目阶段由标题关键词推测，**不能用作项目已获批/开工的法律证明**，应点击原文和政府审批资料核验。
- 项目图像只引用 RSS/媒体提供的公开链接，可能失效、被原站拒绝外链；图片失败时自动显示占位图。网站不下载/转存新闻图片，不转载原文全文。
- 免费方案不包含 AI 中文自动翻译或 AI 摘要；自动抓取的标题和简短摘要通常保留原文语言。浏览器翻译可以辅助阅读。
- **基础模式**收藏存在浏览器 localStorage，不跨设备；**多人模式**收藏存在带 RLS 的 Supabase 用户私有表，需邮箱登录。
- 多人模式前端使用官方 Supabase JS v2 的 CDN 版本，需要浏览器能访问该 CDN。
- GitHub Pages 与 GitHub Actions 的额度及政策可能变化；自行查阅 GitHub 官方定价和使用条款。
- **基础新闻模式**无需配置 Supabase / 数据库 / API 密钥；**多人模式**需要配置 Supabase 公共 URL 和 publishable/anon key，并配置邮件发送。

## 数据来源与机制参考

- https://www.archdaily.com/feed
- https://www.dezeen.com/architecture/feed/
- https://www.archpaper.com/feed
- https://www.designboom.com/architecture/feed/
- https://www.architecturalrecord.com/rss
- https://www.enr.com/rss
- https://news.google.com/rss/search?q=architecture
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/database/postgres/row-level-security

## 测试刷新按钮 / 推荐验证步骤

1. 在 GitHub 发布网站，并在 Actions 手动运行一次 `Daily Architecture News Update`；看到工作流执行成功且有新数据提交后再回网站。
2. 点顶部 **↻ 刷新新闻**。如果新 JSON 比打开页面时多了新闻，提示“新增 N 条”；如果本期只是刷新时间变化，提示“数据重新发布成功，但没有新增文章”。
3. 点左侧 **情报总览**，检查媒体数、日期、阶段图及热门报道的动态变化，再点 **全部新闻** 查看明细。
4. 如果在电脑上直接双击 `index.html`，刷新只能重读本地文件快照，不会调用外部站点。可使用 `python -m http.server 8080` 本地预览，但要更新实际新闻仍需运行 `python scripts/update_news.py`（必须在有互联网的环境中）。

首版 21 条精选新闻由公开媒体页面核对汇总，`feed_count=0` 表示尚未执行真实的在线抓取；只有工作流运行后才报告实际成功来源数。第三方 RSS 可能临时屏蔽请求；抓取程序保留旧文章，不会因个别源不可访问就清空数据。
