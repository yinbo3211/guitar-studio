@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo    Six-String Lab - AI Guitar Studio
echo   ============================================
echo.
echo   Starting local server and opening Edge ...
echo   NOTE: V3 uses ES modules - please visit http://localhost:8765 (not file://)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\server.ps1"
echo.
pause
