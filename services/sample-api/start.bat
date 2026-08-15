@echo off
rem sample-api service launcher
cd /d "%~dp0"
start "sample-api" node server.js
echo sample-api started: http://127.0.0.1:9111/
timeout /t 2 >nul