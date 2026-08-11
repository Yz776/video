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
