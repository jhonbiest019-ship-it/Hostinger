param([switch]$NoWorker)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" }
if (!(Test-Path -LiteralPath $nodePath)) { throw "Install Node.js 20+ and run this script again." }
if (!(Test-Path -LiteralPath ".env.local")) { throw "Configure .env.local before starting." }
$runDirectory = Join-Path $projectRoot ".local-run"
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$configJson = 'require("@next/env").loadEnvConfig(process.cwd());const u=new URL(process.env.DATABASE_URL);console.log(JSON.stringify({host:u.hostname,port:u.port||"3306",database:u.pathname.slice(1),testMode:process.env.EMAIL_TEST_MODE==="true"}));' | & $nodePath -
if ($LASTEXITCODE -ne 0) { throw "Unable to read local database configuration." }
$config = $configJson | ConvertFrom-Json
if ($config.host -in @("127.0.0.1", "localhost")) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$config.port) -ErrorAction SilentlyContinue
  if (!$listener) {
    $mysqlPath = Join-Path $projectRoot ".local-tools\mysql\mysql-8.4.9-winx64\bin\mysqld.exe"
    $dataPath = Join-Path $projectRoot "mysql-test-data"
    if ($config.port -ne "3307" -or $config.database -ne "shotinger_test" -or !(Test-Path -LiteralPath $mysqlPath) -or !(Test-Path -LiteralPath $dataPath)) { throw "Start your configured MySQL server first. Portable startup supports the existing localhost:3307/shotinger_test database only." }
    $basePath = Split-Path -Parent (Split-Path -Parent $mysqlPath)
    Start-Process -FilePath $mysqlPath -ArgumentList @("--no-defaults", "--basedir=`"$basePath`"", "--datadir=`"$dataPath`"", "--port=3307", "--bind-address=127.0.0.1", "--mysqlx=OFF", "--console") -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDirectory "mysql.stdout.log") -RedirectStandardError (Join-Path $runDirectory "mysql.stderr.log") | Out-Null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      if (Get-NetTCPConnection -State Listen -LocalPort 3307 -ErrorAction SilentlyContinue) { break }
      Start-Sleep -Milliseconds 500
    }
    if (!(Get-NetTCPConnection -State Listen -LocalPort 3307 -ErrorAction SilentlyContinue)) { throw "MySQL did not start. Read .local-run/mysql.stderr.log." }
  }
}
function Start-LocalNode([string]$Name, [string]$Entry, [string[]]$ExtraArguments) {
  $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$Entry*" }
  if ($existing) { Write-Output "$Name is already running."; return }
  $arguments = @($Entry) + $ExtraArguments
  $process = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDirectory "$Name.stdout.log") -RedirectStandardError (Join-Path $runDirectory "$Name.stderr.log") -PassThru
  Write-Output "$Name started (PID $($process.Id))."
}
if (!(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)) {
  Start-LocalNode "web" (Join-Path $projectRoot "node_modules\next\dist\bin\next") @("dev", "--hostname", "127.0.0.1")
} else { Write-Output "Port 3000 is already active; using the existing preview." }
if (!$NoWorker) {
  $workerEntry = Join-Path $projectRoot "scripts\worker.ts"
  $existingWorker = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$workerEntry*" }
  if (!$existingWorker) {
    $stopFile = Join-Path $runDirectory "worker.stop"
    if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
    Start-LocalNode "worker" (Join-Path $projectRoot "node_modules\tsx\dist\cli.mjs") @($workerEntry, "--stop-file", $stopFile)
  } else { Write-Output "Worker is already running." }
}
Write-Output "Open http://127.0.0.1:3000"
if ($config.testMode) { Write-Output "TEST MODE: email delivery is simulated. No real emails are sent." }
Write-Output "Keep this computer awake. Logs are in .local-run."
