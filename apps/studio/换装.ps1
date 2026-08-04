# 换装.ps1 — 监制台一键换装（0.23）：等静默窗 → 停旧进程 → 拷 exe → 起新版 → 验活
# 用法：pwsh -File 换装.ps1 [-版本 0.23.0] [-等待分钟 20]
# 静默窗 = /api/runner 的 执行中 为空；有在途执行时换装会杀掉 agent 会话（实测教训）。
param(
  [string]$Version = '',   # 空=读 package.json
  [int]$WaitMinutes = 20,
  [string]$DistDir = 'D:\studio-build\dist',
  [string]$DeployDir = 'D:\GitHub\AI-GameStudio\监制台',
  [int]$Port = 4270
)
$ErrorActionPreference = 'Stop'

# 互斥（0.23.8 教训：两个等窗任务互踩，旧任务把新版本盖回去）
$mutex = Join-Path $env:TEMP 'studio-deploy.lock'
if (Test-Path $mutex) { $age=(Get-Date)-(Get-Item $mutex).LastWriteTime; if ($age.TotalMinutes -lt 45) { Write-Error "另一换装任务持锁中（$([int]$age.TotalMinutes) 分钟前），拒绝并发"; exit 4 } }
Set-Content $mutex (Get-Date) -Encoding utf8
try {

if (-not $Version) {
  # 取产物目录最新 exe 的版本号（避开 PS5.1 的 JSON/BOM 摩擦）
  $latest = Get-ChildItem $DistDir -Filter '监制台 *.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { Write-Error "产物目录无 exe"; exit 1 }
  $Version = $latest.BaseName -replace '^监制台 ', ''
}
$exe = Join-Path $DistDir "监制台 $Version.exe"
if (-not (Test-Path $exe)) { Write-Error "产物不存在：$exe（先 npm run dist）"; exit 1 }
Write-Host "目标版本：$Version"

# 1) 等静默窗
$deadline = (Get-Date).AddMinutes($WaitMinutes)
while ($true) {
  try {
    $st = Invoke-RestMethod "http://127.0.0.1:$Port/api/runner" -TimeoutSec 5
    $busy = @($st.执行中).Count
  } catch { $busy = 0 }  # 服务没起 = 可换
  if ($busy -eq 0) { break }
  if ((Get-Date) -gt $deadline) { Write-Error "等待静默窗超时（仍有 $busy 项执行中）"; exit 2 }
  Write-Host "执行中 $busy 项，等待…"
  Start-Sleep -Seconds 20
}

# 2) 停旧 → 拷贝 → 起新
Get-Process | Where-Object { $_.Name -like '*监制台*' } | Stop-Process -Force -Confirm:$false -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Copy-Item $exe (Join-Path $DeployDir "监制台 $Version.exe") -Force
Start-Process (Join-Path $DeployDir "监制台 $Version.exe") -WorkingDirectory $DeployDir
Start-Sleep -Seconds 10

# 3) 验活
try {
  $cfg = Invoke-RestMethod "http://127.0.0.1:$Port/api/config" -TimeoutSec 8
  Write-Host "换装完成：$Version 已在跑（模型档 项管=$($cfg.模型.项管) 代核=$($cfg.模型.代核)）"
} catch {
  Write-Error "换装后服务无应答——检查 $DeployDir 的 exe 与端口 $Port"
  exit 3
}
} finally { Remove-Item $mutex -Force -ErrorAction SilentlyContinue }
