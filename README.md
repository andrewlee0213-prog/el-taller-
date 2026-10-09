# El Taller de Andres · 安德烈的工坊

个人作品集网站：玻璃拟态暗色视觉，作品集为主体（v1 留空、带打磨中空状态），
内置账号登录与角色权限体系，为后续权限划分预留架构。

## 快速开始

**方式一：本地直开（无需服务）**
- 双击 `index.html` 即可浏览（作品集、问候、时钟都正常）。
- 限制：登录、天气、作品可见性过滤需要服务端，此模式自动降级。

**方式二：服务模式（推荐，功能完整）**

*macOS / Linux：*
```sh
./start-server.sh        # 停止: ./stop-server.sh
```
然后浏览器打开 <http://localhost:8891>。

*Windows：*
1. 双击 `start-server.bat`（需已安装 Node.js 24+；macOS 实测 Node 22 亦可，`node:sqlite` 可用）
2. 浏览器打开 <http://localhost:8891>
3. 手机同局域网访问：先右键「以管理员身份运行」`firewall-allow.bat` 放行端口（macOS 无此步骤，防火墙会自动弹窗询问），
   再访问 `http://你的电脑IP:8891`（启动时控制台会打印局域网地址）
4. 停止：双击 `stop-server.bat`

### macOS 迁移说明（2026-09-24 新机落位）

- 本目录自旧 Windows 机（`C:\Users\XC`）迁入，落位于 `~/Documents/家庭AI/Seed/EchoPPT/个人网站建立/el-taller`。
- 启动/停止用 `start-server.sh` / `stop-server.sh`（bat 为 Windows 保留）。
- 知识库构建脚本（`tools/build-kb.cjs`、`build-kb.js`）的 seed-kb 源目录已改为
  `SEED_KB_DIR` 环境变量可覆盖，默认指向 `~/Documents/家庭AI/Seed/seed-kb`——
  **待 Seed 知识库项目迁入该位置后**，更新流程不变：改源文件 → `node tools/build-kb.cjs` → 重启服务。
- `tools/cdp-*.cjs` 截图脚本已改为跨平台找浏览器（环境变量 `CHROME_PATH` 优先，
  依次探测 Mac Chrome/Edge/Chromium，末位保留 Windows Edge）；本机暂未装 Chrome 系浏览器。
- `tools/make-avatar.ps1`、`make-covers.ps1` 为 Windows PowerShell 素材脚本，素材已生成，无需迁移。
- `data/admin-initial-password.txt` 已删除：admin 密码在旧机上已改（实测初始密码失效），该文件是过期残留。

## 管理员账号

- 首次启动 `server.js` 会自动创建管理员 `admin` 并生成随机初始密码，
  存放在 `data\admin-initial-password.txt`（改完密码后可删除该文件）。
- 首次登录会强制修改初始密码；改密入口也在登录页。
- 注册功能默认关闭；新用户由管理员后续手工建（见下）。
- 管理台占位页：`/admin/`（仅 admin 角色可见，验证守卫用）。

### 角色与可见性

| 角色 | 可见范围 |
|------|----------|
| 未登录（guest） | `visibility: public` 的作品 |
| 登录用户（user） | public + friends |
| 管理员（admin） | 全部（含 private）+ `/admin/` 管理台 |

手工建新用户：在 `el-taller` 目录运行
`node -e "const{DatabaseSync}=require('node:sqlite');const c=require('crypto');const db=new DatabaseSync('data/users.db');const s=c.randomBytes(16).toString('hex');db.prepare('INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,1)').run('用户名',c.scryptSync('初始密码',s,64).toString('hex'),s,'user');console.log('done')"`

## La Biblioteca · 个人 AI 学习知识库（登录可见）

- 入口：主页导航「Biblioteca」或直接访问 `/kb.html`——**必须登录**（未登录 302 去登录页，
  登录后自动跳回；`kb-data.js` 未登录直接 401，数据不下发）。注册关闭，账号由管理员手工建。
- 收录两本书：《AI Agent 构建知识手册》13 章 +《面试题库·见习 AI 应用工程师》9 章，
  支持书本切换、章节导航、全文搜索（带片段预览）、记住上次阅读位置。
- **数据源与同步**：内容来自 `workspace/default/seed-kb/` 的 `03-手册.md` 和 `02-题库.md`；
  按 00 维护机制更新源文件后，重跑 `node tools\build-kb.js` 即重新生成 `kb-data.js`（勿手改）。
- **01 原文存档（课程原文）不入站**——版权属性内容只留本地。
- 权限测试：`node tools\test-kb.mjs`（自动建临时账号验证后删除）。

## 如何添加作品

编辑 `works.js`，向 `window.WORKS` 数组添加对象（文件内有完整字段说明和示例）：

```js
{
  id: 'booking-bot',                    // 唯一标识
  title: '差旅订票机器人',               // 名称
  subtitle: 'Bot de reservas',          // 西语副题（装饰，可省）
  desc: '一句话介绍解决了什么问题。',
  tags: ['Node.js', 'LLM'],
  status: 'terminado',                  // en-obra 打磨中 | terminado 完成 | pausado 暂停
  visibility: 'public',                 // public | friends | private
  cover: '',                            // 封面图路径，留空自动渐变+首字母
  link: ''                              // 详情链接，可省
}
```

保存刷新即生效（服务模式无需重启）。
⚠️ `friends`/`private` 作品只在服务模式下按角色过滤；file:// 直开会全部可见，
上线前请改用服务模式部署。

## 个性化

- 名字/标签/简介/链接/备案号：`index.html` 底部 `<script>` 里的 `CONFIG`。
- 头像：替换 `tools/avatar-216.jpg` 后重跑 `tools/make-avatar.ps1` +
  `node tools\inject-avatar.js`（或在 index.html 里直接换 `__AVATAR_B64__` 已注入的 img src）。
- 天气城市/Key：`server.js` 顶部 `CFG`（和风天气专属 Host + Key + location）。

## 上线：B 方案 · 境内正规部署（已定，按步执行）

> 备案期间域名不得解析上线，本地开发不受影响；全流程约 2~4 周，费用约 ¥100~300/年。

1. **购域名**：阿里云/腾讯云买 `.com`/`.cn`（约 ¥60~80/年），完成实名认证（当天）。
2. **购服务器**：同厂商「轻量应用服务器」2核2G（活动价约 ¥50~100/年），
   系统选 Ubuntu 24.04。注意：备案要求域名与服务器在同一厂商。
3. **ICP 备案**：厂商控制台搜「ICP备案」，免费代办，填身份证+人脸核验，约 2~4 周下号。
4. **部署**：
   - 服务器装 Node 24（`curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt install -y nodejs`）
   - 上传本目录（不含 `data\` 和 `tools\`），`node server.js` 试跑
   - systemd 守护：`/etc/systemd/system/taller.service`（ExecStart=node /opt/taller/server.js），
     `sudo systemctl enable --now taller`
   - 80/443 → 8891 用 Nginx 反代，或直接改 CFG.PORT=80
5. **HTTPS**：云厂商免费证书（或 certbot），Nginx 挂证书；同时在 server.js 的
   sessionCookie 里加 `; Secure`。
6. **备案号**：`index.html` 的 `CONFIG.icp` 填入备案号（自动挂页脚并链到工信部）。

### 上线前自查清单

- [ ] 作品集里涉及公司/客户的内容已脱敏或获得授权（可公开/需脱敏/不可公开逐条过）
- [ ] `data\`（数据库、密钥、初始密码）未上传到服务器
- [ ] sessionCookie 加 `; Secure`，Nginx 限速登录接口
- [ ] `CONFIG.icp` 已填，页脚备案号显示正常

## 版本管理（2026-10-09 入库 GitHub）

- 远程：`git@github.com:andrewlee0213-prog/el-taller.git`（**私有仓**，main 分支）
- **`data/` 整目录不入库**（users.db / session-secret / server-config.json 含密钥与 Cookie / 运行时缓存），新机器部署时按 deploy/DEPLOY.md 第 7 节单独创建
- `data/kb-content.json` 与 `tools/shots/`（60MB 截图存档）同样不入库；kb-content 用 `tools/build-kb.*` 重建
- ⚠ 若仓库将来转公开：`tools/deploy.sh`、`tools/build-kb.*` 内含脱敏词表（功能必需），`server.js` 内含和风天气 Key，`deploy/DEPLOY.md` 内含服务器 IP——先清理再公开
- 日常发布不走 git（服务器按 deploy.sh 的 tar 包更新），git 仅作版本管理与异地备份

## 目录结构

```
el-taller/
├── index.html        主页（单文件自包含，含全部样式与逻辑）
├── login.html        登录页（支持 ?next= 登录后跳回）
├── kb.html           La Biblioteca 知识库（登录可见，玻璃风双书+搜索）
├── kb-data.js        知识库数据（tools/build-kb.js 生成，勿手改）
├── works.js          作品数据（加作品只改这个文件）
├── server.js         应用服务器（静态+认证+SQLite+守卫+天气代理+KB守卫）
├── start/stop-server.bat、firewall-allow.bat
├── assets/           作品封面图
├── data/             运行时生成：users.db、会话密钥、初始密码（勿外传）
└── tools/            头像/封面处理、KB 构建、CDP 截图、自动化测试
```

## 已知边界（v1）

- 作品管理界面未做（`/admin/` 只是守卫占位），加作品走编辑 works.js。
- `node:sqlite` 需 Node 24+；低版本 Node 需改用其他存储。
- 天气 Key 只存服务端，file:// 模式天气卡显示降级提示，属预期行为。
