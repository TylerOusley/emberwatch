@echo off
setlocal
cd /d "%~dp0"
node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 24 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist "node_modules\three" (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://localhost:3000 in your browser after the server starts.
echo Keep this window open while playing. Press Ctrl+C to stop.
call npm start
pause
