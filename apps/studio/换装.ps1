# 换装.ps1 — 监制台一键换装（0.23）：等静默窗 → 停旧进程 → 拷 exe → 起新版 → 验活
# 用法：pwsh -File 换装.ps1 [-版本 0.23.0] [-等待分钟 20]
# 静默窗 = /api/runner 的 执行中 为空；有在途执行时换装会杀掉 agent 会话（实测教训）。
param(
  [string]$Version = '',   # 空=读 package.json
  [int]$WaitMinutes = 20,
  [string]$DistDir = 'D:\studio-build\dist',
  [string]$DeployDir = 'D:\GitHub\AI-GameStudio\监制台',
  [int]$Port = 4270,
  # 源码树（本脚本自己就住在里面）。码印对拍与产物留存都从这里取工具；
  # 显式成参数是为了让 test/deploy-verify.test.js 能把它指向桩目录真跑一遍验活块。
  [string]$SrcDir = $PSScriptRoot
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

# 3) 验活 —— 不只问「有没有应答」，还要问「应答的是不是新版」
# 案源（2026-08-21 体检）：原样只 GET /api/config 看有没有回，**证明不了换的是新版**。
# 当日确认新代码真进了包，靠的是 grep 活体解包出来的 app.asar 二进制——那不该是常规手段。
# 现在活体自报版本（GET /api/version），换装脚本据此断言；对不上就是换装没生效，直接报错退出。
#
# **退出码曾全是空话（2026-08-22 体检实测）**：$ErrorActionPreference=Stop 下 Write-Error 是
# 终止性错误，紧随其后的 exit 那一行根本跑不到——外层 catch 一 rethrow，脚本一律以 1 收场。
# 于是 deploy-ritual 里「exit 5 = 版本没换上 / exit 3 = 服务没应答」的分诊从来没生效过。
# 改法：验活路径上的 Write-Error 一律 -ErrorAction Continue（照样进 stderr，但不抛），
# 让紧随其后的 exit 真的执行。判据见 test/deploy-verify.test.js（拿本块原文真跑）。
#
# @验活-begin —— 以下整块被 test/deploy-verify.test.js 原文抽出、对着桩服务真跑一遍。
# 块内只依赖 $Port / $Version / $SrcDir / $DeployDir 四个变量，别引入第五个。
try {
  $v = Invoke-RestMethod "http://127.0.0.1:$Port/api/version" -TimeoutSec 8
  if ($v.版本 -ne $Version) {
    Write-Error "换装未生效：目标 $Version，活体自报 $($v.版本)——旧进程可能没被停掉，或拷贝落到了别的目录" -ErrorAction Continue
    exit 5
  }
  # 3b) 闸自证在包里（2026-08-22 体检 #0/#2/#8/#10/#39）
  # G15/码印这条闸专治「源码改了、跑着的还是旧的」，而**它自己就装在被审计的产物里**：
  # 漏打进包时不会报错、只会静默缺席，而版本号照样对得上（/api/version 在 buildstamp
  # 加载失败时仍回 版本，只是 码印=null）。08-22 实测跑着的 0.27.0 里根本没有 G15，
  # 而当时的收工判据是「grep -c G15 ≥1」——它 grep 的是源码，源码里当然有。
  # 故收工判据改成三条活体自证：闸在册 · 码印报得出 · G15 零债。
  if (-not $v.码印) {
    Write-Error "换装未生效：活体不报码印——lib/buildstamp 没进包或加载失败，「源改活未改」这条线是瞎的" -ErrorAction Continue
    exit 6
  }
  $attn = Invoke-RestMethod "http://127.0.0.1:$Port/api/attn" -TimeoutSec 8
  if (-not ($attn.注册 | Where-Object { $_.闸号 -eq 'G15' })) {
    Write-Error "换装未生效：活体闸表里没有 G15——码印闸没进包，这条线是瞎的" -ErrorAction Continue
    exit 6
  }
  $g15 = $attn.债 | Where-Object { $_.闸号 -eq 'G15' }
  if ($g15) {
    Write-Error "换装未生效：活体仍落后源码——$($g15.title)。打包用的不是当前源码树，或打包后源码又动过" -ErrorAction Continue
    exit 6
  }
  # 3c) 码印对拍：G15 只在活体**配了 源码路径**时才判得动（没配一律不报债——部署方无源码是正常态）。
  # 换装这一侧源码树必然在手边（本脚本就住在里面），故再独立对一次拍：
  # 既不依赖活体那份配置填没填对，也不依赖 G15 自己是不是好的。
  # node 不在 PATH 时只跳过、不判红：这一步是**加分项**，而此刻新版已经起来并自证过版本了，
  # 为一个取不到的对拍把成功的换装报成失败，是本末倒置（GUI 进程的 PATH 不全，探针实证过）。
  $hasNode = [bool](Get-Command node -ErrorAction SilentlyContinue)
  if ($hasNode -and (Test-Path (Join-Path $SrcDir 'lib/buildstamp.js'))) {
    $srcStamp = & node -e "process.stdout.write(String((require(process.argv[1]).活体()||{}).指纹||''))" (Join-Path $SrcDir 'lib/buildstamp.js')
    if ($srcStamp -and ($v.码印 -ne $srcStamp)) {
      Write-Error "换装未生效：活体码印 $($v.码印) ≠ 源码码印 $srcStamp——打包时源码树已经又往前走了，重打" -ErrorAction Continue
      exit 6
    }
  } else { Write-Host "（未见源码树 $SrcDir，跳过码印对拍）" }

  $cfg = Invoke-RestMethod "http://127.0.0.1:$Port/api/config" -TimeoutSec 8
  Write-Host "换装完成：活体自报 $($v.版本) · 码印 $($v.码印)（与源码同码） · G15 在册且零债 · 模型档 项管=$($cfg.模型.项管) 代核=$($cfg.模型.代核)"
} catch {
  Write-Error "换装后服务无应答或不报版本——检查 $DeployDir 的 exe 与端口 $Port（旧版无 /api/version 端点，首次升级到本版时属正常，可复跑一次确认）" -ErrorAction Continue
  exit 3
}
# @验活-end

# 4) 产物留存（2026-08-22 体检 #52/#61）：换装原样**只拷不删**，dist 与部署目录只进不出。
# 08-21 实测两处共 206 个 exe / 14.2 GB，而 D: 盘只剩 45 GB 且全仓零磁盘余量监控——
# 打满即全 studio 停摆，没有任何东西会先叫一声。存量当日被手工清了，**脚本没改**，
# 不加策略就会原样长回去；本次补的是机制那一半。
# 三条硬约束（策略实现与判据都在 lib/retire.js + test/retire.test.js）：
#   ① 必须在**验活之后**——新版还没证明能起来就先删旧版，等于毁掉唯一的回滚件；
#   ② 在役版本 $Version 进必保集，且 lib/retire.js 按 mtime 排不按文件名（0.17.10 vs 0.17.2）；
#   ③ 删不动的（被占用）只记不抛：此时新版已在跑，为清理失败而报换装失败是本末倒置。
# 保留几版：6（两处手工清理后正好各留 6 版 ≈ 400MB/处）。要改就改这一个数。
$Keep = 6
if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $SrcDir 'lib/retire.js'))) {
  # 整段 try 住：清理失败**绝不许**把一次已经成功的换装报成失败（新版此刻已在跑并自证过版本）。
  try {
    & node (Join-Path $SrcDir 'lib/retire.js') --剪 $DistDir --保留 $Keep --必保 $Version
    & node (Join-Path $SrcDir 'lib/retire.js') --剪 $DeployDir --保留 $Keep --必保 $Version
  } catch { Write-Host "（产物留存跳过：$($_.Exception.Message)）" }
} else { Write-Host "（未见 node 或 $SrcDir/lib/retire.js，跳过产物留存）" }
} finally { Remove-Item $mutex -Force -ErrorAction SilentlyContinue }
