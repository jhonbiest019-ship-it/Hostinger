Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\Shotinger\scripts\ensure-active.ps1"" -OpenBrowser", 0, False
