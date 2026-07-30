# 打包套件.ps1 — 把监制台打成可分发的一键安装压缩包
# 用法：powershell -ExecutionPolicy Bypass -File 打包套件.ps1
# 产物：桌面 AI-GameStudio-套件-<版本>.zip
# 前置：D:\studio-build\dist\ 下已有当前版本 exe（npm run dist 的产物）
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent  # 仓库根
# 布局自适应：私仓 = 监制台\_app；公开仓 = _app
$appDir = if (Test-Path (Join-Path $repo '监制台\_app')) { Join-Path $repo '监制台\_app' } else { Join-Path $repo '_app' }
$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $appDir 'package.json') | ConvertFrom-Json
$ver = $pkg.version
$exe = "D:\studio-build\dist\监制台 $ver.exe"
if (-not (Test-Path $exe)) { throw "找不到 $exe —— 先在 _app 下 npm run dist" }

$stage = Join-Path $env:TEMP "aistudio-suite-stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force "$stage\骨架\岗位协议" | Out-Null
New-Item -ItemType Directory -Force "$stage\骨架\角色协议" | Out-Null
New-Item -ItemType Directory -Force "$stage\骨架\风格库\美术库" | Out-Null

# 装配件
Copy-Item $exe "$stage\监制台 $ver.exe"
Copy-Item (Join-Path $repo '套件\部署.bat') "$stage\部署.bat"
Copy-Item (Join-Path $repo '套件\SETUP.md') "$stage\SETUP.md"
Copy-Item (Join-Path $repo '套件\studio.config.template.json') "$stage\骨架\studio.config.json"
# 新安装默认走通用软件项目角色；旧游戏安装升级时仍可补齐原岗位协议。
Copy-Item (Join-Path $repo '套件\角色协议模板\*.md') "$stage\骨架\角色协议\"
Copy-Item (Join-Path $repo '套件\岗位协议模板\*.md') "$stage\骨架\岗位协议\"
# 风格库空模板（新部署不继承本项目的公理）
Set-Content -Encoding UTF8 "$stage\骨架\风格库\策划标杆.md" "# 策划标杆（提炼式设计公理）`n"

$zip = Join-Path ([Environment]::GetFolderPath('Desktop')) "监制台-套件-v$ver.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
# 打包方式实测记录（PS 5.1 三选一，各有残缺）：
#   Compress-Archive：UTF-8 中文名 ✔，分隔符反斜杠（资源管理器/7-Zip 均正常）← 采用
#   bsdtar -a：分隔符 ✔，但文件名走 ANSI/GBK（非中文系统乱码）✖
#   .NET ZipFile(UTF8)：.NET Framework 下仍反斜杠 + 名字编码不稳 ✖
Compress-Archive -Path "$stage\*" -DestinationPath $zip
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "已打包：$zip（$size MB）"
