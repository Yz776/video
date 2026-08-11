---
Task ID: watermark-bugfix
Agent: main (Super Z)
Task: Fix watermark bug ("wmnya bug") reported by user — improve watermark rendering for "kangwifi cam" overlay.

Work Log:
- Inspected current `buildWatermarkSvg` in `/home/z/my-project/src/app/api/process/route.ts`
- Wrote test script `scripts/test-watermark.js` to render watermark on gray bg for all 5 positions
- Used VLM (z-ai vision) to inspect each rendered position — confirmed center position has icon overlapping text
- Wrote v2 with pill background — VLM detected new clipping bug (text "cam" cut off at right edge for br position because text width estimate was too small)
- Wrote final fix using text-anchor="end" for br/tr (text can never clip), text-anchor="start" for bl/tl, and stacked vertical layout for center
- Confirmed installed fonts (DejaVu Sans, Liberation Sans) and switched from non-existent "Inter, Arial" to "DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif"
- Strengthened drop shadow (stdDeviation from fontSize/18 → fontSize/12) for better legibility on bright photos
- Improved vertical alignment: text baseline at `iconY + iconSize * 0.78` aligns text with icon center
- Tested at 4 sizes (4K, FHD, portrait, preview) × 5 positions = 20 combinations
- VLM verified all positions: no overlap, no clipping, full "kangwifi cam" text visible
- Ran end-to-end API test (scripts/test-api-watermark.js) hitting /api/process with all 5 positions — all returned 200, watermark rendered correctly on JPEG preview

Stage Summary:
- Bug FIXED: Center position no longer has icon overlapping text (now stacked vertically)
- Bug FIXED: Text can never be clipped at image edges (text-anchor properly used)
- Bug FIXED: Font fallback to non-existent Inter/Arial — now uses installed DejaVu Sans
- Improved: Stronger drop shadow for legibility on bright/saturated photos
- Improved: Cleaner vertical alignment between icon and text
- Verified: All 5 positions (bl/br/tl/tr/c) work correctly at all image sizes via direct sharp test AND via actual /api/process endpoint
- Files changed: `/home/z/my-project/src/app/api/process/route.ts` (rewrote buildWatermarkSvg function only)
- Test scripts left in `/home/z/my-project/scripts/` for future regression testing

---
Task ID: remove-wm-improve-quality
Agent: main (Super Z)
Task: User said "hapus aja wmnya dan ganti perbagus aja hinga super hd dan jernih dan tanpa pecah pecah sedikit pun buat agar teknologoi upscale nya meningkat lagi" — remove watermark completely and improve upscale tech to eliminate all "pecah" artifacts.

Work Log:
- Rewrote `/home/z/my-project/src/app/api/process/route.ts` — removed buildWatermarkSvg, escapeXml, all WM params and composite calls
- Updated `types.ts` — removed WatermarkPosition type, watermark/watermarkText/watermarkOpacity fields from CameraSettings, bumped default quality 95→98
- Updated `utils.ts` — removed WM formdata params and response type
- Updated `controls.tsx` — removed WM_POSITIONS constant, "wm" tab, WM tab content (text input, position grid, opacity slider)
- Updated `camera-app.tsx` — replaced "WATERMARK / kangwifi cam" badge with "UPSCALE / 2× HD" badge showing current upscale factor
- Pipeline v1 attempt: pre-denoise median(1) + pre-sharpen + 2-pass upscale + CLAHE + final sharpen sigma=0.7 m1=0.9 + effort=4 — VLM reported "severe blocking artifacts, halos, over-processed"
- Isolation test (`scripts/test-isolate.js`) found the culprit: CLAHE was amplifying JPEG DCT block boundaries (file size jumped 554KB→2611KB = 5x larger, indicating massive high-frequency noise being encoded)
- Pipeline v2 final: pre-denoise median(1) + blur(0.3) [kills JPEG DCT blocks] → multi-pass lanczos3 upscale for 4x → removed CLAHE entirely from default → gentle final sharpen sigma=0.6 m1=0.5 [no halos] → effort=3 [balance speed/quality] → quality=98
- Verified with VLM on clean source (156KB): "Good upscale. No pecah. No halos. Natural high-quality enlargement."
- Verified with VLM on heavily compressed source (70KB): "High-quality upscale. Pre-denoise successfully suppressed artifacts. Looks like native HD capture."
- Performance: 2x upscale 2090x2600 in 6.8s (was 17s with effort=4)
- File size: HEIC 3988KB→738KB (5x smaller, no CLAHE-induced noise to encode)

Stage Summary:
- REMOVED: Watermark feature completely (backend + UI + types)
- IMPROVED upscale tech:
  - Pre-denoise: median(1) + blur(0.3) combo kills JPEG DCT blocks BEFORE they get amplified
  - Multi-pass upscale for 4x (2 passes of 2x with inter-pass median smoothing)
  - REMOVED CLAHE from default pipeline (was the #1 cause of "pecah" — amplified JPEG blocks)
  - Milder final sharpen (sigma 0.8→0.6, m1 1.4→0.5) — no halos
  - Removed pre-sharpen entirely (was creating halos that got amplified)
- IMPROVED HEIC encoding: effort 2→3 (better AV1 RDO, less blocking), quality 95→98 (near-lossless), preview JPEG quality 92→95
- VERIFIED via VLM: "Good upscale. No pecah, no halos. Looks like native HD." on both clean and heavily-compressed sources
- Files changed:
  - `/home/z/my-project/src/app/api/process/route.ts` (full pipeline rewrite)
  - `/home/z/my-project/src/components/camera/types.ts` (removed WM fields)
  - `/home/z/my-project/src/components/camera/utils.ts` (removed WM params)
  - `/home/z/my-project/src/components/camera/controls.tsx` (removed WM tab)
  - `/home/z/my-project/src/components/camera/camera-app.tsx` (replaced WM badge with UPSCALE badge)
- Test scripts left in `/home/z/my-project/scripts/`: test-quality.js, test-photo-quality.js, test-clean-source.js, test-full-res.js, test-direct-sharp.js, test-isolate.js, test-real-photo.js
