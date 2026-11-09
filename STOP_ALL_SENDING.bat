@echo off
title Shotinger Mail - EMERGENCY STOP ALL MAILS
cd /d "D:\Shotinger"
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "D:\Shotinger\scripts\emergency-stop.ps1"
echo.
pause
