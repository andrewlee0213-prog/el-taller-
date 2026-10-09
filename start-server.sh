#!/bin/sh
# El Taller de Andres — 启动服务（macOS/Linux，对应 Windows 的 start-server.bat）
cd "$(dirname "$0")" || exit 1
echo "============================================"
echo " El Taller de Andres - starting server..."
echo " http://localhost:8891"
echo "============================================"
node server.js
