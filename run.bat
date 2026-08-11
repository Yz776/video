@echo off
REM ============================================================================
REM kangwifi cam - One-click Run Script (Windows)
REM Usage:  run.bat [dev|start]
REM ============================================================================
setlocal enabledelayedexpansion

set MODE=%1
if "%MODE%"=="" set MODE=dev

REM Pastikan .env ada
if not exist .env (
  echo [*] Membuat .env ...
  copy .env.example .env >nul
)

REM Pastikan node_modules ada
if not exist node_modules (
  echo [*] Installing dependencies ...
  call npm install --no-audit --no-fund
)

REM Pastikan Prisma client sudah di-generate
if not exist node_modules\.prisma (
  echo [*] Generating Prisma client ...
  if not exist db mkdir db
  call npx prisma generate
  call npx prisma db push --accept-data-loss
)

if /I "%MODE%"=="dev" goto dev
if /I "%MODE%"=="start" goto start
if /I "%MODE%"=="prod" goto start
if /I "%MODE%"=="production" goto start
goto usage

:dev
echo [*] Menjalankan development server di http://localhost:3000
echo     Tekan Ctrl+C untuk stop
echo.
call npm run dev
goto end

:start
if not exist .next\standalone\server.js (
  echo [*] Belum di-build, menjalankan npm run build ...
  call npm run build
)
echo [*] Menjalankan production server di http://localhost:3000
echo     Tekan Ctrl+C untuk stop
echo.
call npm run start
goto end

:usage
echo Usage: run.bat [dev^|start]
echo   dev   = development mode (hot-reload, default)
echo   start = production mode (sudah di-build)

:end
