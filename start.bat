@echo off
rem ============================================
rem  dfd - Single Page Hub Launcher (后台静默版)
rem  双击: 后台无窗口启动 node server.js
rem  可选参数: start.bat 9090  (自定义端口)
rem  日志: server.log   停止: stop.bat
rem  想完全零闪窗: 直接双击 start-hidden.vbs
rem ============================================
cd /d "%~dp0"
set "PORT=%~1"

where node >nul 2>nul
if errorlevel 1 (
    echo [Error] Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)

rem 经 wscript 中转, 以隐藏窗口运行 (mshta 在 Win11 新版已被禁用)
wscript "%~dp0start-hidden.vbs" %PORT%
