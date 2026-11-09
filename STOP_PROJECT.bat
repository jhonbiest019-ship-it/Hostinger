@echo off
title Stopping Shotinger Mail...
cd /d "D:\Shotinger"
powershell.exe -ExecutionPolicy Bypass -File "D:\Shotinger\scripts\stop-local.ps1"
echo Shotinger services stopped.
pause
exit
