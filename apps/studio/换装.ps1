# 换装.ps1 — 监制台一键换装（0.23）：等静默窗 → 停旧进程 → 拷 exe → 起新版 → 验活
# 用法：pwsh -File 换装.ps1 [-版本 0.23.0] [-等待分钟 20]
# 静默窗 = /api/runner 的 执行中 为空；有在途执行时换装会杀掉 agent 会话（实测教训）。
param(
  [string]$版本 = '',
  [int]$等待分钟 = 20,
  [string]$产物目录 = 'D:\studio-build\dist',
  [string]$部署目录 = 'D:\GitHub\AI-GameStudio\监制台',
  [int]$端口 = 4270
)
$ErrorActionPreference = 'Stop'

if (-not $版本) {
  $pkg = Join-Path $PSScriptRoot 'package.json'
  $版本 = (Get-Content $pkg -Raw | ConvertFrom-Json).version
}
$exe = Join-Path $产物目录 "监制台 $版本.exe"
if (-not (Test-Path $exe)) { Write-Error "产物不存在：$exe（先 npm run dist）"; exit 1 }
Write-Host "目标版本：$版本"

# 1) 等静默窗
$deadline = (Get-Date).AddMinutes($等待分钟)
while ($true) {
  try {
    $st = Invoke-RestMethod "http://127.0.0.1:$端口/api/runner" -TimeoutSec 5
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
Copy-Item $exe (Join-Path $部署目录 "监制台 $版本.exe") -Force
Start-Process (Join-Path $部署目录 "监制台 $版本.exe") -WorkingDirectory $部署目录
Start-Sleep -Seconds 10

# 3) 验活
try {
  $cfg = Invoke-RestMethod "http://127.0.0.1:$端口/api/config" -TimeoutSec 8
  Write-Host "换装完成：$版本 已在跑（模型档 项管=$($cfg.模型.项管) 代核=$($cfg.模型.代核)）"
} catch {
  Write-Error "换装后服务无应答——检查 $部署目录 的 exe 与端口 $端口"
  exit 3
}
