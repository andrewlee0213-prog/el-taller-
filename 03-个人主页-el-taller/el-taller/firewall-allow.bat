@echo off
REM ============================================================
REM  Allows LAN access (e.g. phone) to El Taller on port 8891.
REM  Right-click this file and choose "Run as administrator".
REM ============================================================
netsh advfirewall firewall delete-rule name="El Taller 8891" >nul 2>&1
netsh advfirewall firewall add rule name="El Taller 8891" dir=in action=allow protocol=TCP localport=8891
if %errorlevel%==0 (
    echo Firewall rule added. Phones on the same LAN can now visit http://YOUR-PC-IP:8891
) else (
    echo FAILED. Please right-click this file and "Run as administrator".
)
pause
