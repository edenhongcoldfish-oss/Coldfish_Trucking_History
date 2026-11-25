@echo off
rem Double-click once. After this, backups copy automatically in the background (no window).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-backup.ps1"
pause
