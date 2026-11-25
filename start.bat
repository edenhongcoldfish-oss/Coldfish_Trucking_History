@echo off
rem Trip Log - double-click to start the app and open it in your browser.
rem First run installs what it needs (takes a minute). Close with stop.bat.
cd /d "%~dp0"
title Trip Log
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. The download page will open. Install the LTS version, then run start.bat again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
echo Checking files...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo Install failed. Check the internet connection and try again.
  pause
  exit /b 1
)
call "%~dp0stop.bat" quiet
echo Starting Trip Log...
start "Trip Log server - close this window to stop" /min cmd /c "npm run demo > server.log 2>&1"
echo Waiting for Trip Log to start (first start after an update can take up to a minute)...
powershell -NoProfile -Command "for ($i = 0; $i -lt 90; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:3000/healthz | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo.
  echo Trip Log did not start. The last lines of server.log:
  powershell -NoProfile -Command "if (Test-Path server.log) { Get-Content server.log -Tail 20 }"
  echo.
  echo Try reset-demo.bat, then start.bat again. If it still fails, send server.log to your admin.
  pause
  exit /b 1
)
start "" http://localhost:3000
exit /b 0
