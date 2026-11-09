$wsh = New-Object -ComObject WScript.Shell

$desktopDir = [Environment]::GetFolderPath('Desktop')
$startupDir = [Environment]::GetFolderPath('Startup')

# 1. Desktop Shortcut
$desktopShortcut = $wsh.CreateShortcut((Join-Path $desktopDir "Shotinger Mail.lnk"))
$desktopShortcut.TargetPath = "wscript.exe"
$desktopShortcut.Arguments = '""D:\Shotinger\scripts\start-and-open.vbs""'
$desktopShortcut.WorkingDirectory = "D:\Shotinger"
$desktopShortcut.Description = "Open Shotinger Hostinger Mail & Campaign Management"
if (Test-Path "D:\Shotinger\public\favicon.ico") {
    $desktopShortcut.IconLocation = "D:\Shotinger\public\favicon.ico"
}
$desktopShortcut.Save()
$p1 = Join-Path $desktopDir 'Shotinger Mail.lnk'
Write-Output "Desktop shortcut created at: $p1"

# 2. Windows Startup Shortcut (Permanent auto-start on boot)
$startupShortcut = $wsh.CreateShortcut((Join-Path $startupDir "Shotinger_AutoStart.lnk"))
$startupShortcut.TargetPath = "wscript.exe"
$startupShortcut.Arguments = '""D:\Shotinger\scripts\start-silent.vbs""'
$startupShortcut.WorkingDirectory = "D:\Shotinger"
$startupShortcut.Description = "Shotinger Mail Auto-Start Service"
if (Test-Path "D:\Shotinger\public\favicon.ico") {
    $startupShortcut.IconLocation = "D:\Shotinger\public\favicon.ico"
}
$startupShortcut.Save()
$p2 = Join-Path $startupDir 'Shotinger_AutoStart.lnk'
Write-Output "Startup shortcut created at: $p2"

# 3. Desktop Emergency Stop Shortcut (Instant 1-Click Kill Switch)
$stopShortcut = $wsh.CreateShortcut((Join-Path $desktopDir "EMERGENCY_STOP_MAILS.lnk"))
$stopShortcut.TargetPath = "cmd.exe"
$stopShortcut.Arguments = '/c ""D:\Shotinger\STOP_ALL_SENDING.bat""'
$stopShortcut.WorkingDirectory = "D:\Shotinger"
$stopShortcut.Description = "Instantly kill all sending workers and pause all scheduled email campaigns"
$stopShortcut.IconLocation = "shell32.dll,27"
$stopShortcut.Save()
$p3 = Join-Path $desktopDir 'EMERGENCY_STOP_MAILS.lnk'
Write-Output "Emergency Stop shortcut created at: $p3"
