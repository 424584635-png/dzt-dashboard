# 大众包 · 骑手实时出勤看板（网站版）

一比一复刻轩辕「实时骑手监控 / 有效出勤监控」的网页看板。数据从轩辕实时考勤接口爬取（listKnightAttendance），由本服务定时刷新，前端渲染看板。

## 目录
- public/        前端（index.html / id1.html / id2.html / app.js / styles.css / data.js）
- server.js      静态服务 + /api/data + 定时爬取
- scrape.js      单次爬取（写入 data.json）
- scrape-core.js 爬取与字段映射
- data.json      最新一次爬取的数据（看板直接读它）
- history.json   近 30 天历史
- config.json     你的轩辕 Cookie（不提交，见 config.example.json）

## 本地运行
1. 安装 Node.js 18+。
2. 复制 config.example.json 为 config.json，填入你登录轩辕后的 Cookie（浏览器开发者工具 -> Application -> Cookies -> 复制整个站点的 Cookie 字符串）。
3. 启动： node server.js  （或 npm start）
4. 打开 http://localhost:3000  （id1.html=当前时段监控，id2.html=有效出勤监控）。

不填 Cookie 也能跑：会用 data.json 里的示例/上次数据展示页面。

## 部署成「固定网址」
方式 A · 纯静态（数据需手动/定时更新）：
- 把 public/ 目录拖到 Netlify Drop / Cloudflare Pages / GitHub Pages。
- 部署前先在本机 node scrape.js 生成最新 data.json，并把 data.json 一起上传。
- 要更新数据：本机重跑 node scrape.js，再把新的 data.json 重新部署。

方式 B · 全栈（自动实时刷新，推荐）：
- 部署整个文件夹到任意支持 Node 的托管（Railway / Render / 你自己的服务器 / 容器）。
- 设置环境变量 PORT（平台给的端口），把 config.json（含 Cookie）放进去。
- 启动 node server.js，平台会给你一个固定网址（如 xxx.railway.app）。服务每 60s 自动爬取更新。

## 数据说明
- 当前时段「在线时长」若接口仅返回全天在线，则用全天值近似（已在看板逻辑中注明）；如接口返回时段字段会自动采用。
- 如需把字段映射定死到 100%，把 config 里 Cookie 配好后跑一次，把 data.json 里一条 rider 的 raw 字段发我即可。


## 固定网址（两种）
1. 纯静态最快：直接把 public/ 拖到 Netlify Drop 或 Cloudflare Pages，立刻得到固定链接（public/ 内已含最新 data.json，页面直接显示真实数据）。更新数据：本机 node scrape.js 后重新上传。
2. 自动实时：把整个 web/ 部署到支持 Node 的平台（Railway/Render/自有服务器），配置 config.json 的 Cookie，node server.js 每 60s 自动爬取，页面自动刷新。
