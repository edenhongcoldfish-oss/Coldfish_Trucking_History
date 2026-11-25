@echo off
rem Removes the automatic backup task. Already copied backup files are kept.
schtasks /Delete /TN "TruckingBackup" /F
pause
