Set WshShell = CreateObject("WScript.Shell")
strStartup = WshShell.SpecialFolders("Startup")
Set shortcut = WshShell.CreateShortcut(strStartup & "\Shotinger_AutoStart.lnk")
shortcut.TargetPath = "wscript.exe"
shortcut.Arguments = """D:\Shotinger\scripts\start-silent.vbs"""
shortcut.WorkingDirectory = "D:\Shotinger"
shortcut.Description = "Shotinger Mail Permanent Auto-Start"
shortcut.Save
WScript.Echo "Startup shortcut successfully created: " & strStartup & "\Shotinger_AutoStart.lnk"
