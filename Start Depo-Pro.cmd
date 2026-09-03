@echo off
setlocal
cd /d "%~dp0"
if exist "node_modules\node\bin\node.exe" (
  "node_modules\node\bin\node.exe" "scripts\start-local.mjs"
) else (
  node "scripts\start-local.mjs"
)
if errorlevel 1 (
  echo.
  echo Depo-Pro could not start. Review the message above.
  pause
)
