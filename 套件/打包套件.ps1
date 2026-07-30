# 打包套件.ps1 — 把监制台打成可分发的一键安装压缩包
# 用法：powershell -ExecutionPolicy Bypass -File 打包套件.ps1
# 产物：默认写入 _app\dist\package，也可用 -OutputDirectory 指定
param(
  [string]$ExePath = '',
  [string]$OutputDirectory = ''
)
# 前置：先在 _app 下运行 npm run dist；默认从 package.json 的 build 输出目录寻找 exe。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent  # 仓库根
# 布局自适应：私仓 = 监制台\_app；公开仓 = _app
$appDir = if (Test-Path (Join-Path $repo '监制台\_app')) { Join-Path $repo '监制台\_app' } else { Join-Path $repo '_app' }
$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $appDir 'package.json') | ConvertFrom-Json
$ver = $pkg.version
$buildOutput = [string]$pkg.build.directories.output
if (-not [IO.Path]::IsPathRooted($buildOutput)) { $buildOutput = Join-Path $appDir $buildOutput }
if (-not $ExePath) {
  $candidate = Get-ChildItem -LiteralPath $buildOutput -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*$ver*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($candidate) { $ExePath = $candidate.FullName }
}
if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) { throw "找不到监制台 exe —— 先在 _app 下运行 npm run dist，或使用 -ExePath 指定" }

$stage = Join-Path ([IO.Path]::GetTempPath()) ("aistudio-suite-stage-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force "$stage\骨架\岗位协议" | Out-Null
New-Item -ItemType Directory -Force "$stage\骨架\角色协议" | Out-Null
New-Item -ItemType Directory -Force "$stage\骨架\风格库\美术库" | Out-Null

# 装配件
Copy-Item -LiteralPath $ExePath "$stage\监制台 $ver.exe"
Copy-Item (Join-Path $repo '套件\部署.bat') "$stage\部署.bat"
Copy-Item (Join-Path $repo '套件\SETUP.md') "$stage\SETUP.md"
Copy-Item (Join-Path $repo 'docs\部署调试与完整使用手册.md') "$stage\完整使用手册.md"
# 仓库内 SETUP 从套件目录链接到 ../docs；分发包里手册与 SETUP 同级，打包时修正链接。
$setupFile = "$stage\SETUP.md"
$setupText = Get-Content -Raw -Encoding UTF8 $setupFile
$setupText.Replace('../docs/部署调试与完整使用手册.md', '完整使用手册.md') | Set-Content -Encoding UTF8 $setupFile
Copy-Item (Join-Path $repo '套件\studio.config.template.json') "$stage\骨架\studio.config.json"
# 新安装默认走通用软件项目角色；旧游戏安装升级时仍可补齐原岗位协议。
Copy-Item (Join-Path $repo '套件\角色协议模板\*.md') "$stage\骨架\角色协议\"
Copy-Item (Join-Path $repo '套件\岗位协议模板\*.md') "$stage\骨架\岗位协议\"
# 风格库空模板（新部署不继承本项目的公理）
Set-Content -Encoding UTF8 "$stage\骨架\风格库\策划标杆.md" "# 策划标杆（提炼式设计公理）`n"

$destination = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $buildOutput 'package' }
New-Item -ItemType Directory -Force $destination | Out-Null
$zip = Join-Path $destination "监制台-套件-v$ver.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
# 打包方式实测记录（PS 5.1 三选一，各有残缺）：
#   Compress-Archive：UTF-8 中文名 ✔，分隔符反斜杠（资源管理器/7-Zip 均正常）← 采用
#   bsdtar -a：分隔符 ✔，但文件名走 ANSI/GBK（非中文系统乱码）✖
#   .NET ZipFile(UTF8)：.NET Framework 下仍反斜杠 + 名字编码不稳 ✖
Compress-Archive -Path "$stage\*" -DestinationPath $zip
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Host "已打包：$zip（$size MB）"
