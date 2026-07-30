@echo off
setlocal

if exist "%LOCALAPPDATA%\AIWorkflowStudio\studio.config.json" (
  for %%F in ("%LOCALAPPDATA%\AIWorkflowStudio\*.exe") do if exist "%%~fF" (
    start "" "%%~fF"
    exit /b 0
  )
)

if not defined STUDIO_ROOT set "STUDIO_ROOT=%USERPROFILE%\AIStudioDev"
if not exist "%STUDIO_ROOT%\studio.config.json" if exist "%~dp0studio.config.json" set "STUDIO_ROOT=%~dp0"
set "APP_DIR=%~dp0_app"
set "ELECTRON=%APP_DIR%\node_modules\electron\dist\electron.exe"

if exist "%STUDIO_ROOT%\studio.config.json" (
  for %%F in ("%APP_DIR%\dist\*.exe") do if exist "%%~fF" (
    start "" "%%~fF"
    exit /b 0
  )
)

if not exist "%STUDIO_ROOT%\studio.config.json" goto missing_config
if not exist "%ELECTRON%" goto missing_electron

cd /d "%APP_DIR%"
"%ELECTRON%" .
set "LAUNCH_EXIT=%ERRORLEVEL%"
if not "%LAUNCH_EXIT%"=="0" goto launch_failed
exit /b 0

:missing_config
echo Launch failed: studio.config.json was not found.
echo Expected: %STUDIO_ROOT%\studio.config.json
pause
exit /b 1

:missing_electron
echo Launch failed: Electron was not found.
echo Expected: %ELECTRON%
pause
exit /b 1

:launch_failed
echo Launch failed: Electron exit code %LAUNCH_EXIT%.
pause
exit /b %LAUNCH_EXIT%
