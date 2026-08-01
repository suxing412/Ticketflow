@echo off
chcp 65001 >nul
title AI 工作室 · 一键部署
echo ============================================
echo   AI 工作室（监制台）一键部署
echo   全流程：起草 - 投池 - agent 拉取执行 - QA - 验收
echo ============================================
echo.

set "DEFAULT_DIR=%LOCALAPPDATA%\AIWorkflowStudio"
set /p TARGET=安装目录（回车用默认 %DEFAULT_DIR%）：
if "%TARGET%"=="" set "TARGET=%DEFAULT_DIR%"
set "STUDIO_DEPLOY_TARGET=%TARGET%"

set "SOURCE_EXE="
for %%F in ("%~dp0监制台 *.exe") do set "SOURCE_EXE=%%~fF"
if not defined SOURCE_EXE (
  echo [错误] 安装包内没有找到“监制台 *.exe”，请重新下载或打包。
  pause
  exit /b 1
)

echo.
echo [1/4] 建目录并铺骨架 ...
if not exist "%TARGET%" mkdir "%TARGET%"
if not exist "%TARGET%\风格库" xcopy /e /i /y "%~dp0骨架\风格库" "%TARGET%\风格库" >nul
if exist "%TARGET%\studio.config.json" (
  echo     已有配置，保留不覆盖（升级模式）
  if not exist "%TARGET%\角色协议" xcopy /e /i /y "%~dp0骨架\角色协议" "%TARGET%\角色协议" >nul
  if not exist "%TARGET%\岗位协议" xcopy /e /i /y "%~dp0骨架\岗位协议" "%TARGET%\岗位协议" >nul
) else (
  copy /y "%~dp0骨架\studio.config.json" "%TARGET%\studio.config.json" >nul
  if not exist "%TARGET%\角色协议" xcopy /e /i /y "%~dp0骨架\角色协议" "%TARGET%\角色协议" >nul
)

echo [2/4] 复制监制台 exe ...
copy /y "%SOURCE_EXE%" "%TARGET%\" >nul
for %%F in ("%SOURCE_EXE%") do set "INSTALLED_EXE=%TARGET%\%%~nxF"
if exist "%~dp0完整使用手册.md" copy /y "%~dp0完整使用手册.md" "%TARGET%\完整使用手册.md" >nul

echo [3/4] 注册第一个项目（执行 agent 的目标仓库；可留空，稍后在 参数页-项目注册 里加）
set "PNAME="
set /p PNAME=项目名（如 MYGAME，直接回车跳过）：
if "%PNAME%"=="" goto :launch
set /p PPATH=项目仓库绝对路径（如 D:\GitHub\MYGAME）：
if not exist "%PPATH%" (
  echo     路径不存在，跳过注册——稍后在参数页里补
  goto :launch
)
set "STUDIO_PROJECT_NAME=%PNAME%"
set "STUDIO_PROJECT_PATH=%PPATH%"
powershell -NoProfile -Command "$p=Join-Path $env:STUDIO_DEPLOY_TARGET 'studio.config.json'; $name=$env:STUDIO_PROJECT_NAME; $projectPath=$env:STUDIO_PROJECT_PATH.Replace('\','/'); $c=Get-Content -Raw -Encoding UTF8 $p | ConvertFrom-Json; $c.'项目'.'注册' | Add-Member -MemberType NoteProperty -Name $name -Value ([pscustomobject]@{ '路径'=$projectPath; '说明'='' }) -Force; $c.'项目'.'默认'=$name; $c | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p"
echo     已注册 %PNAME% 并设为默认项目

:launch
echo [4/4] 创建桌面快捷方式并启动监制台 ...
set "STUDIO_INSTALLED_EXE=%INSTALLED_EXE%"
if not defined STUDIO_SKIP_SHORTCUT powershell -NoProfile -Command "$desktop=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop '监制台.lnk')); $s.TargetPath=$env:STUDIO_INSTALLED_EXE; $s.WorkingDirectory=$env:STUDIO_DEPLOY_TARGET; $s.Save()"
if not defined STUDIO_SKIP_LAUNCH start "" "%INSTALLED_EXE%"
echo.
echo ============================================
echo   部署完成。验收标准只有一条：
echo   打开后看 总览 右上角「环境」—— 就绪 = 一切可用
echo   降级/阻断则悬停看原因，或进 设置(右上角齿轮) 看全链路自检
echo   前置要求见 SETUP.md（codex/claude CLI 登录、代理）
echo ============================================
if not defined STUDIO_SKIP_PAUSE pause
exit /b 0
