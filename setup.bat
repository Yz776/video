@echo off
REM ============================================================================
REM kangwifi cam - One-click Setup Script (Windows)
REM Run:  setup.bat
REM ============================================================================
setlocal enabledelayedexpansion

echo ================================================
echo   kangwifi cam - Setup
echo ================================================

REM --- Cek Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js belum terinstall.
  echo     Install dari: https://nodejs.org ^(pilih LTS, v20+^)
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js: %NODE_VER%

REM --- Cek npm ---
where npm >nul 2>nul
if errorlevel 1 (
  echo [X] npm belum terinstall.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('npm -v') do set NPM_VER=%%v
echo [OK] npm: %NPM_VER%

REM --- Setup .env ---
if not exist .env (
  echo.
  echo [*] Membuat .env dari .env.example ...
  copy .env.example .env >nul
  echo [OK] .env dibuat
) else (
  echo [OK] .env sudah ada
)

REM --- Install dependencies ---
echo.
  echo [*] Installing dependencies (butuh 2-5 menit) ...
call npm install --no-audit --no-fund
echo [OK] Dependencies terinstall

REM --- Init database ---
echo.
echo [*] Setup database SQLite ...
if not exist db mkdir db
call npx prisma generate
call npx prisma db push --accept-data-loss
echo [OK] Database siap

REM --- Build (opsional, untuk production) ---
echo.
echo [*] Building project (production mode) ...
call npm run build
echo [OK] Build selesai

echo.
echo ================================================
echo   ^|^| SETUP SELESAI!
echo ================================================
echo.
echo Cara run:
echo   Development:  npm run dev     (hot-reload, http://localhost:3000)
echo   Production :  npm run start   (sudah di-build)
echo.
echo Akses dari HP (HTTPS wajib untuk kamera):
echo   npm install -g localtunnel ^&^& lt --port 3000
echo.
pause
