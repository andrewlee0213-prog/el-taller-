@echo off
set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8891 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
    set FOUND=1
)
if "%FOUND%"=="1" (
    echo Server on port 8891 stopped.
) else (
    echo No server running on port 8891.
)
pause
