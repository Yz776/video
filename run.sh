#!/usr/bin/env bash
# ============================================================================
# kangwifi cam — One-click Run Script (Linux / macOS)
# Run:  bash run.sh [dev|start]
# ============================================================================
set -e

MODE="${1:-dev}"

# Pastikan .env ada
if [ ! -f .env ]; then
  echo "📝 Membuat .env ..."
  cp .env.example .env
fi

# Pastikan node_modules ada
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies ..."
  npm install --no-audit --no-fund
fi

# Pastikan Prisma client sudah di-generate
if [ ! -d node_modules/.prisma ]; then
  echo "🗄️  Generating Prisma client ..."
  mkdir -p db
  npx prisma generate
  npx prisma db push --accept-data-loss
fi

case "$MODE" in
  dev)
    echo "🚀 Menjalankan development server di http://localhost:3000"
    echo "   Tekan Ctrl+C untuk stop"
    echo ""
    npm run dev
    ;;
  start|prod|production)
    # Pastikan sudah di-build
    if [ ! -f .next/standalone/server.js ]; then
      echo "🔨 Belum di-build, menjalankan npm run build ..."
      npm run build
    fi
    echo "🚀 Menjalankan production server di http://localhost:3000"
    echo "   Tekan Ctrl+C untuk stop"
    echo ""
    npm run start
    ;;
  *)
    echo "Usage: bash run.sh [dev|start]"
    echo "  dev   = development mode (hot-reload, default)"
    echo "  start = production mode (sudah di-build)"
    exit 1
    ;;
esac
