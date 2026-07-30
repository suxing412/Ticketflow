@echo off
chcp 65001 >nul
title AI 工作室 · 一键部署
echo ============================================
echo   AI 工作室（监制台）一键部署
echo   全流程：起草 - 投池 - agent 拉取执行 - QA - 验收
echo ============================================
echo.

set "DEFAULT_DIR=%USERPROFILE%\Desktop\AI工作室"
set /p TARGET=安装目录（回车用默认 %DEFAULT_DIR%）：
if "%TARGET%"=="" set "TARGET=%DEFAULT_DIR%"

echo.
echo [1/4] 建目录并铺骨架 ...
if not exist "%TARGET%" mkdir "%TARGET%"
if not exist "%TARGET%\风格库" xcopy /e /i /y "%~dp0骨架\风格库" "%TARGET%\风格库" >nul
if exist "%TARGET%\studio.config.json" (
  echo     已有配置，保留不覆盖（升级模式）
  if not exist "%TARGET%\岗位协议" xcopy /e /i /y "%~dp0骨架\岗位协议" "%TARGET%\岗位协议" >nul
) else (
  copy /y "%~dp0骨架\studio.config.json" "%TARGET%\studio.config.json" >nul
  if not exist "%TARGET%\角色协议" xcopy /e /i /y "%~dp0骨架\角色协议" "%TARGET%\角色协议" >nul
)

echo [2/4] 复制监制台 exe ...
for %%F in ("%~dp0监制台 *.exe") do copy /y "%%F" "%TARGET%\" >nul

echo [3/4] 注册第一个项目（执行 agent 的目标仓库；可留空，稍后在 参数页-项目注册 里加）
set "PNAME="
set /p PNAME=项目名（如 MYGAME，直接回车跳过）：
if "%PNAME%"=="" goto :launch
set /p PPATH=项目仓库绝对路径（如 D:\GitHub\MYGAME）：
if not exist "%PPATH%" (
  echo     路径不存在，跳过注册——稍后在参数页里补
  goto :launch
)
powershell -NoProfile -Command "$p='%TARGET%\studio.config.json'; $c=Get-Content -Raw $p | ConvertFrom-Json; $c.'项目'.'注册' | Add-Member -MemberType NoteProperty -Name '%PNAME%' -Value (New-Object PSObject -Property @{ '路径'='%PPATH%'.Replace('\','/'); '说明'='' }) -Force; $c.'项目'.'默认'='%PNAME%'; $c | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $p"
echo     已注册 %PNAME% 并设为默认项目

:launch
echo [4/4] 启动监制台 ...
for %%F in ("%TARGET%\监制台 *.exe") do start "" "%%F"
echo.
echo ============================================
echo   部署完成。验收标准只有一条：
echo   打开后看 总览 右上角「环境」—— 就绪 = 一切可用
echo   降级/阻断则悬停看原因，或进 设置(右上角齿轮) 看全链路自检
echo   前置要求见 SETUP.md（codex/claude CLI 登录、代理）
echo ============================================
pause
