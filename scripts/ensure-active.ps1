param([switch]$OpenBrowser)

$ErrorActionPreference = "SilentlyContinue"
$projectRoot = "D:\Shotinger"
Set-Location -LiteralPath $projectRoot

$nodePath = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (!(Test-Path -LiteralPath $nodePath)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { $nodePath = $nodeCommand.Source }
}

$mysqlPath = "D:\Shotinger\.local-tools\mysql\mysql-8.4.9-winx64\bin\mysqld.exe"
$dataPath = "D:\Shotinger\mysql-test-data"
$runDir = "D:\Shotinger\.local-run"
if (!(Test-Path $runDir)) { New-Item -ItemType Directory -Path $runDir -Force | Out-Null }

# 1. Ensure MySQL is listening on 3307
$mysqlListening = Get-NetTCPConnection -State Listen -LocalPort 3307 -ErrorAction SilentlyContinue
if (!$mysqlListening) {
  $basePath = "D:\Shotinger\.local-tools\mysql\mysql-8.4.9-winx64"
  Start-Process -FilePath $mysqlPath -ArgumentList @("--no-defaults", "--basedir=`"$basePath`"", "--datadir=`"$dataPath`"", "--port=3307", "--bind-address=127.0.0.1", "--mysqlx=OFF", "--console") -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir "mysql.stdout.log") -RedirectStandardError (Join-Path $runDir "mysql.stderr.log") | Out-Null
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -State Listen -LocalPort 3307 -ErrorAction SilentlyContinue) { break }
  }
}

# 2. Ensure Next.js is listening on 3000
$webListening = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
if (!$webListening) {
  $nextBin = Join-Path $projectRoot "node_modules\next\dist\bin\next"
  Start-Process -FilePath $nodePath -ArgumentList @($nextBin, "dev", "--hostname", "127.0.0.1") -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir "web.stdout.log") -RedirectStandardError (Join-Path $runDir "web.stderr.log") | Out-Null
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) { break }
  }
}

# 3. Ensure Worker is running
$workerEntry = Join-Path $projectRoot "scripts\worker.ts"
$existingWorker = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*worker.ts*" }
if (!$existingWorker) {
  $tsxBin = Join-Path $projectRoot "node_modules\tsx\dist\cli.mjs"
  Start-Process -FilePath $nodePath -ArgumentList @($tsxBin, $workerEntry) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir "worker.stdout.log") -RedirectStandardError (Join-Path $runDir "worker.stderr.log") | Out-Null
}

# 4. Open in default browser if requested
if ($OpenBrowser) {
  Start-Sleep -Milliseconds 500
  Start-Process "http://localhost:3000"
}
