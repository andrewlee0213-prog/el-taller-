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
if grep -rlnE '中达|祥承|Judy|泛微|北森|钉钉|offer多多|asistandedeandres|gk_live|Seed 部门|Seed 案例|订票机器人案例|ROI≥1' \
  index.html login.html kb.html kb-data.js works.js notes.js server.js workbench.html \
  poster-six.html about-site.html kindle-dashboard.html video-scripts.html posts/ data/kb-content.json 2>/dev/null; then
  echo "⚠ 扫描命中上方文件，先脱敏再发布（构建产物请改 tools/build-kb.* 的 SANITIZE 后重建）"; exit 1
fi
# 工作台配置模板不能带真实 Key/Cookie 进包（tools/ 本就不打包，这里双保险）
if grep -qE 'SESSDATA=[A-Za-z0-9%]{20}' tools/server-config.example.json 2>/dev/null; then
  echo "⚠ tools/server-config.example.json 里疑似有真实 Cookie，先清掉"; exit 1
fi
echo "  零命中 ✓"

echo "── 2/5 打包 ──"
# 根目录 HTML 自动收集（新页面不再漏打包）；其余为固定清单
HTMLS=$(ls *.html)
tar --no-xattrs --no-mac-metadata -czf /tmp/taller.tar.gz \
  $HTMLS kb-data.js works.js notes.js server.js \
  assets posts \
  data/kb-content.json \
  deploy/taller.service deploy/nginx-taller.conf
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
for p in "" works.js poster-six.html posts/kb-engineering.html; do
  printf "  /%s → %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://110.40.209.237/$p")"
done
wbcode=$(curl -s -o /dev/null -w '%{http_code}' "http://110.40.209.237/workbench.html")
echo "  /workbench.html → $wbcode（302=守卫生效 ✓ / 200=异常，立即检查！）"
echo "完成。线上地址: http://110.40.209.237（备案后换 https://tallerdeandres.cn）"
