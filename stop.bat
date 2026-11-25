@echo off
rem Trip Log - stops the app if it is running (anything listening on port 3000).
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>nul
  set FOUND=1
)
if /i "%~1"=="quiet" exit /b 0
if defined FOUND (echo Trip Log stopped.) else (echo Trip Log was not running.)
timeout /t 2 /nobreak >nul
exit /b 0
