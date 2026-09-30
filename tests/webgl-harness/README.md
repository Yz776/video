# WebGL pixel harness

Regression harness for the client-side camera GPU pipeline
(`src/components/camera/webgl/`). It bundles the real modules with esbuild,
runs them on a live GPU, and asserts pixel stats (mean RGB, hue ordering,
output dims) — this is how the "hasil foto blank hitam" bug was reproduced
and verified fixed.

Pages (served by `node serve.js` on :5299):

- `index.html` — 8-case matrix ×2 suites (auto WebGL2 + forced WebGL1):
  default 2×, night, 4×, 1:1 crop, mono, enhance, 4032×3024 source, tiny 64×64.
  Results in `window.__RESULTS` and on-page text. 16/16 must PASS.
- `diag.html` — per-stage readback (upload → copy → bilateral → grade →
  canvas blit + toBlob) with `gl.getError()` per stage. Results in
  `window.__DIAG`. Use this first when output looks wrong: the first stage
  whose mean collapses to a solid color is the broken one.

Rebuild bundles after editing the engine (node has no bun here; esbuild via npx):

```bash
npx -y esbuild@0.25.0 src/components/camera/webgl/processor.ts --bundle --format=esm --outfile=tests/webgl-harness/webgl-bundle.js --log-level=silent
npx -y esbuild@0.25.0 src/components/camera/webgl/gl-core.ts --bundle --format=esm --outfile=tests/webgl-harness/gl-core-bundle.js --log-level=silent
npx -y esbuild@0.25.0 src/components/camera/webgl/shaders.ts --bundle --format=esm --outfile=tests/webgl-harness/shaders-bundle.js --log-level=silent
npx -y esbuild@0.25.0 src/components/camera/webgl/program.ts --bundle --format=esm --outfile=tests/webgl-harness/program-bundle.js --log-level=silent
node tests/webgl-harness/serve.js   # http://localhost:5299
```

Server-side equivalent: `node scripts/test-server-passthrough.js` (needs
`npx next dev -p 3000` running) validates `/api/process` passthrough +
legacy + night HEIC output with sharp.
