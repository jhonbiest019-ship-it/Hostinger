$ErrorActionPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDirectory = Join-Path $projectRoot ".local-run"
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null

$workerEntry = "worker.ts"
$workers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$workerEntry*" })
if ($workers.Count -gt 0) {
  Set-Content -LiteralPath (Join-Path $runDirectory "worker.stop") -Value "stop"
  Write-Output "Stopping background worker(s)..."
  Start-Sleep -Milliseconds 800
  $workers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$workerEntry*" })
  foreach ($process in $workers) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

$nextEntry = Join-Path $projectRoot "node_modules\next\"
$web = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$nextEntry*" })
foreach ($process in $web) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Output "Local worker and web preview stopped. MySQL remains running."
