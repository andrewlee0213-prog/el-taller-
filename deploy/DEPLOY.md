# El Taller de Andres · 服务器部署手册（腾讯云轻量 · Ubuntu 24.04）

> **当前状态（2026-09-30）：已按第 0~3 步上线，IP 直访 http://110.40.209.237 正常运行（systemd 守护 + nginx 80 反代，SSH 密钥登录已配好）。**
> 第 4~6 步（域名解析 → HTTPS → 备案号）等 ICP 备案通过后执行，完成后 IP 地址自动退役。
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
