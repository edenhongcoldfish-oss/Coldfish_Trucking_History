@echo off
rem Trip Log - deletes the local demo database and starts again with fresh sample data.
cd /d "%~dp0"
choice /m "Delete all local test data and start fresh"
if errorlevel 2 exit /b 0
call "%~dp0stop.bat" quiet
timeout /t 1 /nobreak >nul
if exist "%~dp0data" rmdir /s /q "%~dp0data"
call "%~dp0start.bat"
