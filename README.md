# kangwifi cam

Android camera PWA dengan output HEIC, ultra-HD quality, dan mode Photo / Video / Live Photo. 100% cloud — hasil foto langsung di-upload ke `cloud.kangwifi.eu.org`.

## Quick Start

### Linux / macOS

```bash
# 1. Clone project
git clone https://github.com/Yz776/video.git kangwifi-cam
cd kangwifi-cam

# 2. One-click setup (install deps + init DB + build)
bash setup.sh

# 3. Run
bash run.sh          # development (hot-reload)
# atau
bash run.sh start    # production (sudah di-build)
```

### Windows

```cmd
git clone https://github.com/Yz776/video.git kangwifi-cam
cd kangwifi-cam

setup.bat            :: one-click setup

run.bat dev          :: development
run.bat start        :: production
```

### Manual (kalau script di atas gagal)

```bash
git clone https://github.com/Yz776/video.git kangwifi-cam
cd kangwifi-cam
cp .env.example .env
npm install
npx prisma generate
npx prisma db push --accept-data-loss
npm run dev          # http://localhost:3000
```

## Requirements

- **Node.js v18.18+** (recommended v20 LTS) — cek dengan `node -v`
- **npm v9+** — cek dengan `npm -v`
- Tidak butuh database server (pakai SQLite bawaan)

## Akses dari HP (PWA)

Kamera butuh HTTPS. Pilih salah satu:

### Opsi 1 — localtunnel (paling gampang)
```bash
npm install -g localtunnel
lt --port 3000
# Dapat URL https://<random>.loca.lt → buka di HP
```

### Opsi 2 — ADB reverse (USB debugging)
```bash
adb reverse tcp:3000 tcp:3000
# Buka http://localhost:3000 di HP
```

### Opsi 3 — Deploy ke Vercel / Railway / VPS
Push repo, set env `DATABASE_URL`, deploy. HTTPS otomatis.

## Install sebagai App di Android

1. Buka URL (HTTPS) di Chrome Android
2. Menu ⋮ → **"Add to Home screen"** / **"Install app"**
3. Buka dari home screen → kamera langsung jalan

## Scripts

| Command            | Fungsi                                  |
|--------------------|-----------------------------------------|
| `npm run dev`      | Development server (hot-reload, port 3000) |
| `npm run build`    | Build production (standalone output)    |
| `npm run start`    | Run production server (pakai bun)       |
| `npm run lint`     | ESLint check                            |
| `npm run db:push`  | Sync Prisma schema ke SQLite            |
| `npm run db:generate` | Generate Prisma Client               |

## Tech Stack

- **Next.js 16** (App Router, standalone output)
- **React 19** + TypeScript
- **Tailwind CSS 4** + shadcn/ui
- **Prisma 6** + SQLite
- **sharp** (image processing, HEIC encode)
- **z-ai-web-dev-sdk** (AI integrations)

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── process/         # HEIC processing pipeline
│   │   ├── cloud-upload/    # Upload ke cloud.kangwifi.eu.org
│   │   ├── cloud-list/      # List cloud files
│   │   └── cloud-delete/    # Delete cloud file
│   ├── page.tsx             # Home (camera)
│   └── layout.tsx
├── components/camera/
│   ├── camera-app.tsx       # Main orchestrator (100% cloud)
│   ├── controls.tsx         # UI (settings, topbar, capture btn)
│   ├── gallery.tsx          # CloudStrip + JustCapturedModal
│   ├── types.ts             # Type definitions
│   └── utils.ts             # Helpers (processToHeic, uploadToCloud, dll)
└── lib/
public/                      # PWA assets (icons, manifest)
prisma/schema.prisma         # SQLite schema
```

## Troubleshooting

**`next not found`** → jalankan `npm install` dulu.

**`DATABASE_URL` error** → pastikan file `.env` ada (copy dari `.env.example`).

**Kamera gak muncul di HP** → pastikan akses via HTTPS (pakai localtunnel) atau localhost.

**502 Bad Gateway saat foto** → HEIC pipeline terlalu berat untuk RAM 4GB. Edit `src/app/api/process/route.ts`, turunkan `effort: 4` → `3` dan hapus `chromaSubsampling: "4:4:4"`.

**Prisma error** → jalankan `npx prisma generate && npx prisma db push --accept-data-loss`.
