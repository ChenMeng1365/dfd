@echo off
rem ============================================
rem  dfd - Single Page Hub Launcher
rem  Double-click to start, Ctrl+C to stop
rem ============================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set PORT=8080
if not "%1"=="" set PORT=%1

where node >nul 2>nul
if errorlevel 1 (
    echo [Error] Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)

echo Starting dfd hub on port %PORT%...
rem node server.js will auto-increment port if busy and open browser itself
node server.js
if errorlevel 1 (
    echo.
    echo Failed to start. Common cause: port in use.
    echo Try: start.bat 9090
)
pause