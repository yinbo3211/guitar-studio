@echo off
rem P0-04 fix: pure ASCII content + chcp 936, so cmd.exe always decodes
rem this script correctly regardless of system code page (was UTF-8 + 65001).
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo     Liu Xian Gong Fang - Public Hosting (Nginx + IPv6 DDNS)
echo   ============================================
echo.

rem ---- Elevate to administrator (firewall / port listen) ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges, please click "Yes"...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

rem Default port 8080; edit the number below to change it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-windows.ps1" -Port 8080

echo.
pause
