@echo off
REM ---------------------------------------------------------------------------
REM  NexStream - one-click launcher (Windows)
REM  Double-click this file.
REM ---------------------------------------------------------------------------
title NexStream
cd /d "%~dp0"

echo ===========================================
echo   NexStream - starting up
echo ===========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install the LTS version from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo Node %%v detected.

if not exist "node_modules" (
  echo First run - installing dependencies ^(about 20 seconds^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

echo Starting the dev server...
echo Open http://localhost:3000 in your browser.
echo Press Ctrl + C in this window to stop the server.
echo.

call npm run dev
pause
