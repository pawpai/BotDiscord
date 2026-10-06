@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Please install Node.js 24.17.0 or newer.
  pause
  exit /b 1
)
if not exist "node_modules\discord.js\package.json" (
  echo Dependencies are missing. Run npm.cmd install in this folder.
  pause
  exit /b 1
)
node "src\index.js" %*
set "BOT_EXIT_CODE=%ERRORLEVEL%"
if /i "%~1"=="--check-config" exit /b %BOT_EXIT_CODE%
echo.
echo Bot stopped. If an error appeared, check .env and config.json.
pause
exit /b %BOT_EXIT_CODE%
