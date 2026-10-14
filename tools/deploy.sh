#!/bin/sh
# ============================================================
# El Taller 发布脚本 — 本地改完内容后一条命令上线
# 用法: ./tools/deploy.sh   （在 el-taller 目录下执行，或任意位置）
# 流程: 敏感词快扫 → 打包 → scp 上传 → 解压 → 重启 systemd → 冒烟
# 前提: 本机 ~/.ssh 能免密登录 ubuntu@110.40.209.237（2026-09-30 已配好）
# ============================================================
set -e
HOST=ubuntu@110.40.209.237
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

echo "── 1/5 敏感词快扫 ──"
SCAN="$(mktemp /tmp/taller-scan.XXXXXX)"
node -e 'const w=JSON.parse(require("fs").readFileSync("tools/sanitize.local.json","utf8"));process.stdout.write(w.scan.join("\n"))' > "$SCAN" \
  || { echo "⚠ 生成扫描词表失败（需要 node + 本机 tools/sanitize.local.json）"; exit 1; }
if grep -rlnE -f "$SCAN" \
  index.html login.html kb.html kb-data.js works.js notes.js server.js workbench.html \
  poster-six.html about-site.html kindle-dashboard.html video-scripts.html posts/ data/kb-content.json 2>/dev/null; then
  echo "⚠ 扫描命中上方文件，先脱敏再发布（构建产物请改 tools/sanitize.local.json 后重建）"; rm -f "$SCAN"; exit 1
fi
rm -f "$SCAN"
# 工作台配置模板不能带真实 Key/Cookie 进包（tools/ 本就不打包，这里双保险）
if grep -qE 'SESSDATA=[A-Za-z0-9%]{20}' tools/server-config.example.json 2>/dev/null; then
  echo "⚠ tools/server-config.example.json 里疑似有真实 Cookie，先清掉"; exit 1
fi
echo "  零命中 ✓"

echo "── 2/5 打包 ──"
# 根目录 HTML 自动收集（新页面不再漏打包）；assets 走 find 白名单（models/ 扫描件不上线）；
# ._*/.DS_Store 一律滤掉（Finder 复制会凭空造出来，2026-10-14 曾上过服务器）；
# 不用 tar --exclude：bsdtar 3.5.3 与 --no-xattrs 同用时解析错乱
HTMLS=$(ls *.html | grep -v '^\._')
ASSETS=$(find assets -type f ! -path 'assets/models/*' ! -name '._*')
POSTS=$(find posts -type f ! -name '._*')
tar --no-xattrs --no-mac-metadata -czf /tmp/taller.tar.gz \
  $HTMLS kb-data.js works.js notes.js server.js \
  $ASSETS $POSTS \
  data/kb-content.json \
  deploy/taller.service deploy/nginx-taller.conf deploy/nginx-yoyo.conf
echo "  /tmp/taller.tar.gz ✓（含 $HTMLS）"

echo "── 3/5 上传 ──"
scp -o BatchMode=yes /tmp/taller.tar.gz "$HOST:/tmp/" >/dev/null
echo "  ✓"

echo "── 4/5 服务器解压 + 重启 ──"
ssh -o BatchMode=yes "$HOST" 'set -e
  cd /opt/taller
  tar -xzf /tmp/taller.tar.gz
  sudo systemctl restart taller
  sleep 1
  systemctl is-active --quiet taller && echo "  taller active ✓"'
echo "── 5/5 冒烟 ──"
# 2026-10-13 起 IP 直访退役（certbot 80 端口对非域名 Host 返 404），冒烟走正式域名
for p in "" works.js poster-six.html posts/kb-engineering.html; do
  printf "  /%s → %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://tallerdeandres.cn/$p")"
done
wbcode=$(curl -s -o /dev/null -w '%{http_code}' "https://tallerdeandres.cn/workbench.html")
echo "  /workbench.html → $wbcode（302=守卫生效 ✓ / 200=异常，立即检查！）"
echo "完成。线上地址: https://tallerdeandres.cn（SSH/上传仍走 110.40.209.237）"
