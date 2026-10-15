@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo    六弦工坊 · 外网托管（Nginx + IPv6 DDNS）
echo   ============================================
echo.

REM ---- 自动申请管理员权限（防火墙/监听需要）----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 正在申请管理员权限，请在弹窗中点击“是”...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

REM 可传入端口参数：本脚本默认 8080；如需改端口，直接改下面一行末尾数字
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-windows.ps1" -Port 8080

echo.
pause
