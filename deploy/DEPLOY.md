# El Taller de Andres · 服务器部署手册（腾讯云轻量 · Ubuntu 24.04）

> **当前状态（2026-10-13）：0~6 步全部完成。正式地址 https://tallerdeandres.cn（Let's Encrypt 证书，2027-01-11 到期，certbot 自动续期；HTTP 强制跳 HTTPS）。IP 直访已退役（certbot 80 端口对非域名 Host 返 404），SSH/上传仍走 110.40.209.237。**
> 日常内容更新**不要重走本手册**，用 `tools/deploy.sh` 一条命令发布（快扫→打包→上传→重启→冒烟）。
> 域名：tallerdeandres.cn。以下命令除标注「本地电脑执行」外，均在服务器上执行（控制台「登录」或 SSH）。

## 0. 上传网站文件（本地电脑执行）

在 `el-taller` 目录打开 cmd：

```bat
tar -czf taller.tar.gz --exclude=data --exclude=tools --exclude=deploy index.html login.html kb.html kb-data.js works.js server.js assets
scp taller.tar.gz ubuntu@服务器公网IP:/tmp/
```

（也可以直接让我打包好，你拖进控制台的文件上传。）

## 1. 装 Node 24 并部署

```bash
# 装 Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 解压到 /opt/taller
sudo mkdir -p /opt/taller
cd /opt/taller
sudo tar -xzf /tmp/taller.tar.gz
sudo chown -R ubuntu:ubuntu /opt/taller

# 试跑一次
cd /opt/taller && node server.js
# 看到「服务已启动」后 Ctrl+C 停掉，交给 systemd 守护
```

## 2. systemd 守护（开机自启、崩溃自拉起）

```bash
sudo cp /tmp/taller.service /etc/systemd/system/   # 此文件随 deploy/ 一起上传
sudo systemctl daemon-reload
sudo systemctl enable --now taller
sudo systemctl status taller        # 应显示 active (running)
```

常用命令：`sudo systemctl restart taller` / `journalctl -u taller -f`（看日志）

此刻用 http://服务器IP:8891 应该能打开（防火墙放行 8891，或直接进下一步用 80）。

## 3. Nginx 反代（80 端口）

```bash
sudo apt-get install -y nginx
sudo cp /tmp/nginx-taller.conf /etc/nginx/sites-available/taller
sudo ln -s /etc/nginx/sites-available/taller /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 4. 解析域名（备案通过后才做！）

腾讯云控制台 →「我的域名」→ tallerdeandres.cn → 解析记录，添加两条：

| 主机记录 | 记录类型 | 记录值 |
|---|---|---|
| @ | A | 服务器公网 IP |
| www | A | 服务器公网 IP |

## 5. HTTPS 免费证书（Let's Encrypt，自动续期）

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tallerdeandres.cn -d www.tallerdeandres.cn
# 按提示选「重定向 HTTP→HTTPS」。证书 90 天，certbot 自动续期
```

完成后 https://tallerdeandres.cn 即为正式站点。
登录 Cookie 会自动带 Secure 标志（server.js 已支持，无需再改）。

## 6. 上线核对

- [ ] 页脚备案号：index.html 的 CONFIG.icp 填入备案号，重新上传
- [ ] `data/` 目录没有从本机带上来（服务器首次启动会自动生成全新管理员）
- [ ] 浏览器无痕窗口验证：主页公开可看、Biblioteca 跳登录、登录后可读
- [ ] `sudo journalctl -u taller -n 50` 无报错刷屏

## 7. 工作台（El Estudio）一次性配置

工作台页面 `/workbench.html` 仅 admin 登录可见（未登录 302 去登录页），五路数据由服务器定时抓取，
配置存 `data/server-config.json`（BLOCKED 目录永不对外、部署不覆盖）——**部署后做一次即可**：

```bash
# 服务器上执行（或本地编辑好 scp 上去）
cat > /opt/taller/data/server-config.json <<'JSON'
{
  "glmKey": "你的GLM API Key（open.bigmodel.cn 控制台，同一把 Key 用于额度/翻译/arXiv选文/周总结）",
  "biliCookie": "SESSDATA=xxx; buvid3=xxx（浏览器 F12 → 网络 → 任意 bilibili 请求 → Cookie 整串）",
  "biliUps": [ { "uid": "UP主空间地址里的数字", "name": "备注名" } ]
}
JSON
sudo systemctl restart taller
```

也可以不碰 ssh：登录工作台后在页面底部 **Ajustes · 设置** 里粘贴 Key / Cookie / UP 清单，效果相同。

- 抓取节奏：GLM 额度 5 分钟 · 油价 24h（失败 30 分钟重试）· B站 144 分钟 · Anthropic 24h（腾讯云直连，连不上显示暂不可用）· arXiv 五段选文 24h（失败 20 分钟重试）
- **GLM 卡的"缓存命中率"来自 Mac 本机上报**（ZCode 的 SQLite 服务器读不到）：Mac 上装了 launchd 任务
  `~/Library/LaunchAgents/cn.andrewlee0213.taller-hitrate.plist`（每 30 分钟跑
  `~/Library/Application Support/GLMWidget/push-hitrate.sh`，用 `data/server-config.json` 里的 `pushToken` 鉴权
  POST `/api/workbench/hitrate`）。换服务器或重装时：删掉服务器 pushToken 后重启会重新生成，Mac 脚本里的 TOKEN 同步替换
- 运行时数据都在 `data/`：`workbench-cache.json`（抓取缓存，重启回放）、`workbench-log.json`（工作记录）、
  `workbench-weekly.json`（周总结/计划）、`workbench-comments.json`（观后评论，arXiv 评论自动反馈选文）、
  `cuaderno-extra.json`（收进日志的笔记，首页 Cuaderno 合并渲染）
- 验证：无痕窗口开 `http://服务器IP/workbench.html` 应跳登录页；admin 登录后应看到五卡陆续出数
