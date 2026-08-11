#!/usr/bin/env bash
# ============================================================================
# kangwifi cam — One-click Setup Script (Linux / macOS)
# Run:  bash setup.sh
# ============================================================================
set -e

echo "================================================"
echo "  kangwifi cam — Setup"
echo "================================================"

# --- Cek Node.js ---
if ! command -v node &>/dev/null; then
  echo "❌ Node.js belum terinstall."
  echo "   Install dari: https://nodejs.org (pilih LTS, v20+)"
  echo "   Atau jalankan: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js versi $(node -v) — butuh v18.18 atau lebih baru."
  exit 1
fi
echo "✅ Node.js: $(node -v)"

# --- Cek npm ---
if ! command -v npm &>/dev/null; then
  echo "❌ npm belum terinstall."
  exit 1
fi
echo "✅ npm: $(npm -v)"

# --- Setup .env ---
if [ ! -f .env ]; then
  echo ""
  echo "📝 Membuat .env dari .env.example ..."
  cp .env.example .env
  echo "✅ .env dibuat"
else
  echo "✅ .env sudah ada"
fi

# --- Install dependencies ---
echo ""
echo "📦 Installing dependencies (butuh 2-5 menit) ..."
npm install --no-audit --no-fund
echo "✅ Dependencies terinstall"

# --- Init database ---
echo ""
echo "🗄️  Setup database SQLite ..."
mkdir -p db
npx prisma generate
npx prisma db push --accept-data-loss
echo "✅ Database siap"

# --- Build (opsional, untuk production) ---
echo ""
echo "🔨 Building project (production mode) ..."
npm run build
echo "✅ Build selesai"

echo ""
echo "================================================"
echo "  🎉 SETUP SELESAI!"
echo "================================================"
echo ""
echo "Cara run:"
echo "  Development:  npm run dev     (hot-reload, http://localhost:3000)"
echo "  Production :  npm run start   (sudah di-build)"
echo ""
echo "Akses dari HP (HTTPS wajib untuk kamera):"
echo "  npm install -g localtunnel && lt --port 3000"
echo ""
