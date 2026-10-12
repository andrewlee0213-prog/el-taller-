#!/bin/sh
# El Taller de Andres — 停止服务（杀掉占用 8891 端口的进程，对应 Windows 的 stop-server.bat）
PIDS=$(lsof -ti :8891 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill
  echo "Server on port 8891 stopped."
else
  echo "No server running on port 8891."
fi
