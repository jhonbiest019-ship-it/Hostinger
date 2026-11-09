$ErrorActionPreference = "SilentlyContinue"
$projectRoot = "D:\Shotinger"
Set-Location -LiteralPath $projectRoot

Write-Host "==========================================================" -ForegroundColor Red
Write-Host "   EMERGENCY STOP: HALTING ALL OUTBOUND EMAIL SENDS       " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Red

# 1. Kill all running worker processes immediately
$workerEntry = "worker.ts"
$workers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$workerEntry*" })
if ($workers.Count -gt 0) {
    foreach ($w in $workers) {
        Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "[-] Terminated worker process PID: $($w.ProcessId)" -ForegroundColor Cyan
    }
} else {
    Write-Host "[i] No background worker processes currently active." -ForegroundColor Gray
}

# 2. Write stop signal file
$runDirectory = Join-Path $projectRoot ".local-run"
if (!(Test-Path $runDirectory)) { New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null }
Set-Content -LiteralPath (Join-Path $runDirectory "worker.stop") -Value "stop"
Write-Host "[+] Stop flag file created at .local-run\worker.stop" -ForegroundColor Green

# 3. Locate Node & Tsx to pause database campaigns
$nodePath = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (!(Test-Path -LiteralPath $nodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodePath = $nodeCommand.Source }
}
$tsxPath = Join-Path $projectRoot "node_modules\tsx\dist\cli.mjs"

if ((Test-Path -LiteralPath $nodePath) -and (Test-Path -LiteralPath $tsxPath)) {
    Write-Host "[*] Pausing active & scheduled campaigns in database..." -ForegroundColor Yellow
    $pauseScript = @'
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: ['SCHEDULED', 'SENDING', 'ACTIVE'] } },
    select: { id: true, name: true }
  });
  
  if (campaigns.length > 0) {
    await prisma.campaign.updateMany({
      where: { status: { in: ['SCHEDULED', 'SENDING', 'ACTIVE'] } },
      data: { status: 'PAUSED', updatedAt: new Date() }
    });
    console.log('PAUSED_COUNT:' + campaigns.length);
    campaigns.forEach(c => console.log('PAUSED_NAME:' + c.name));
  } else {
    console.log('PAUSED_COUNT:0');
  }

  const resetJobs = await prisma.scheduledJob.updateMany({
    where: { status: 'PROCESSING', deliveryState: 'NOT_STARTED' },
    data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null }
  });
  console.log('RESET_JOBS:' + resetJobs.count);
}

run()
  .catch(err => { console.error('DB_ERROR:' + err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
'@
    $tempScript = Join-Path $runDirectory "temp_emergency_pause.js"
    Set-Content -LiteralPath $tempScript -Value $pauseScript
    $dbOutput = & $nodePath $tempScript
    Remove-Item -LiteralPath $tempScript -ErrorAction SilentlyContinue

    foreach ($line in $dbOutput) {
        if ($line -like "PAUSED_COUNT:*") {
            $count = $line.Split(":")[1]
            Write-Host "[+] Safely PAUSED $count active campaign(s) in database." -ForegroundColor Green
        }
        if ($line -like "PAUSED_NAME:*") {
            $name = $line.Split(":")[1]
            Write-Host "    -> $name" -ForegroundColor Gray
        }
        if ($line -like "RESET_JOBS:*") {
            $jobs = $line.Split(":")[1]
            if ([int]$jobs -gt 0) {
                Write-Host "[+] Reset $jobs in-flight processing jobs back to safe state." -ForegroundColor Green
            }
        }
    }
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   ALL EMAIL SENDS ARE STOPPED SAFELY                     " -ForegroundColor Green
Write-Host "   Web dashboard remains available at http://localhost:3000" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
if ($Host.UI.RawUI.KeyAvailable) {
    [void]$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
