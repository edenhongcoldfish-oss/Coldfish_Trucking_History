@echo off
rem Trip Log - SHARED TEST MODE. Run this on ONE office PC (the "host").
rem Everyone else opens the address shown below in their browser and sees the same data.
rem Test data only. The real app runs on the company NAS (see README).
cd /d "%~dp0"
title Trip Log (shared test)

rem 1) Let other PCs on this office network or on Tailscale reach port 3000 (asks for admin permission once)
netsh advfirewall firewall show rule name=TripLogTest3000 >nul 2>nul
if errorlevel 1 (
  echo Windows will ask once for permission to let other office PCs open Trip Log. Click Yes.
  powershell -NoProfile -Command "try { Start-Process netsh -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList 'advfirewall firewall add rule name=TripLogTest3000 dir=in action=allow protocol=TCP localport=3000 remoteip=LocalSubnet,100.64.0.0/10 profile=any' } catch { }"
)
netsh advfirewall firewall show rule name=TripLogTest3000 >nul 2>nul
if errorlevel 1 echo WARNING: permission was not given, so other PCs may not connect. Run start-shared.bat again and click Yes.

rem 2) Start the app so other PCs can reach it (start.bat does the install and opens it here)
echo If Windows asks whether to allow Node.js on networks, click Allow.
set HOST=0.0.0.0
call "%~dp0start.bat"
if errorlevel 1 exit /b 1

rem 3) Show the address to give to coworkers
echo.
echo ================================================================
echo   Trip Log is running and shared. On other PCs, type this
echo   address in the browser (Whale, Chrome or Edge):
echo.
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object { '      http://' + $_.IPAddress + ':3000      (' + $_.InterfaceAlias + ')' }"
echo.
echo   Use the one on Wi-Fi/Ethernet in the office. The 100.x one
echo   (Tailscale) works for people on Tailscale outside the office.
echo.
echo   Keep THIS PC switched on and awake. All test data is saved
echo   on this PC only. To stop sharing: double-click stop.bat.
echo ================================================================
echo.
echo You can close this window. Trip Log keeps running.
pause
exit /b 0
