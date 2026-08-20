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

# 1) 等静默窗（执行会话 + 项管会话都要空——起草/收口/裁决被换装杀过两次：09:44 起草案、15:28 收口案）
$deadline = (Get-Date).AddMinutes($WaitMinutes)
while ($true) {
  $busy = 0; $pmBusy = $false
  try {
    $st = Invoke-RestMethod "http://127.0.0.1:$Port/api/runner" -TimeoutSec 5
    $busy = @($st.执行中).Count
  } catch { $busy = 0 }  # 服务没起 = 可换
  try {
    $relay = Invoke-RestMethod "http://127.0.0.1:$Port/api/relay" -TimeoutSec 5
    if ($null -ne $relay.作业) { $pmBusy = $true }
  } catch { $pmBusy = $false }
  if (($busy -eq 0) -and (-not $pmBusy)) { break }
  if ((Get-Date) -gt $deadline) { Write-Error "等待静默窗超时（执行中 $busy 项 / 项管忙 $pmBusy）"; exit 2 }
  Write-Host "执行中 $busy 项 / 项管忙 $pmBusy，等待…"
  Start-Sleep -Seconds 20
}

# 2) 停旧 → 拷贝 → 起新
Get-Process | Where-Object { $_.Name -like '*监制台*' } | Stop-Process -Force -Confirm:$false -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Copy-Item $exe (Join-Path $DeployDir "监制台 $Version.exe") -Force
Start-Process (Join-Path $DeployDir "监制台 $Version.exe") -WorkingDirectory $DeployDir
Start-Sleep -Seconds 10

# 2b) 同步开机自启脚本的版本号（2026-08-20 断电复盘）
# 自启 vbs 里写死着 exe 文件名。不同步改，下次断电重启会**静默拉起上一个版本**——
# 界面能开、接口能通，只是跑的是旧代码，这种错最难发现（比起不来更坏）。
# 故接进换装脚本：换装即改，不靠人记。
$vbs = Join-Path $DeployDir "启动监制台.vbs"
if (Test-Path $vbs) {
  $c = [System.IO.File]::ReadAllText($vbs, [System.Text.Encoding]::Unicode)
  $n = [regex]::Replace($c, '监制台 [\d.]+\.exe', "监制台 $Version.exe")
  if ($n -ne $c) {
    [System.IO.File]::WriteAllText($vbs, $n, [System.Text.Encoding]::Unicode)
    Write-Host "自启脚本已跟版：$Version"
  }
} else { Write-Host "（未见 启动监制台.vbs，跳过自启跟版）" }

# 3) 验活
try {
  $cfg = Invoke-RestMethod "http://127.0.0.1:$Port/api/config" -TimeoutSec 8
  Write-Host "换装完成：$Version 已在跑（模型档 项管=$($cfg.模型.项管) 代核=$($cfg.模型.代核)）"
} catch {
  Write-Error "换装后服务无应答——检查 $DeployDir 的 exe 与端口 $Port"
  exit 3
}
} finally { Remove-Item $mutex -Force -ErrorAction SilentlyContinue }
