@echo off
chcp 65001 >nul
title AI-DevPlatform 一键部署
setlocal

echo ============================================
echo   AI-DevPlatform 一键部署
echo   建单 - 派活 - 真跑 - 质检 - 提交
echo ============================================
echo.

REM Node 是硬前置：本产品零第三方依赖，但它本身就是 node 程序。
REM 先验一句，比让人看见一屏 'node' 不是内部或外部命令 要好。
where node >nul 2>nul
if errorlevel 1 (
  echo [x] 没找到 node。本产品是 node 程序（零第三方依赖，但要有 node 运行时）。
  echo     装一个 Node.js 18+ 再回来：https://nodejs.org/
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [1/3] node %%v 已就位

echo [2/3] 配置 ...
echo.
REM 真正干活的是 scripts/首装.js —— 它走产品自己的 落位 函数，
REM 不在批处理里现拼 JSON。配置长什么样只有一处知道，主配置演进不会让这里悄悄过期。
node "%~dp0scripts\首装.js"
set "SETUP_CODE=%errorlevel%"

echo.
if "%SETUP_CODE%"=="1" (
  echo [!] 自检未就绪 —— 上面标红那几行就是还缺的东西。
  echo     照着补完重跑本脚本即可；也可以先起服务，界面上补工单库与项目注册。
  echo.
)

set /p LAUNCH=[3/3] 现在起服务？[Y/n]：
if /i "%LAUNCH%"=="n" goto :done

REM 前台起：三个进程的日志混在这个窗口里，Ctrl-C 一起收摊。
REM 不用 start 另开窗——装机的人正需要看这几行（端口、写权开没开、真跑开没开）。
call npm start

:done
echo.
echo ============================================
echo   验收标准只有一条：自检显示「全链路就绪」
echo   界面右上角也能看；命令行：npm start 后打 /api/selfcheck
echo   前置要求（claude / codex CLI 登录）见 SETUP.md
echo ============================================
pause
endlocal
