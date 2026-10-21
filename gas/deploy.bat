@echo off
chcp 65001 > nul
rem Publish both GitHub Pages and the existing GAS app, then verify both.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\publish.ps1"
set "publish_result=%ERRORLEVEL%"
pause
exit /b %publish_result%
