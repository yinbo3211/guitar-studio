@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo    Six-String Lab - AI Guitar Studio
echo   ============================================
echo.
echo   Starting local server and opening Edge ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
echo.
pause
