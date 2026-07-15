# Verify: insta-subtitles-edit

Browser-only React/Vite video editor (Hebrew, RTL). No tests; verification is
driving the app in headless Chromium.

## Build / launch

```bash
npm install --ignore-scripts   # sharp postinstall 403s through the proxy; not needed
npm run lint && npm run build  # oxlint + tsc -b + vite
npm run dev -- --port 5199 --strictPort   # dev server (background)
```

## Drive (Playwright)

- `npm i playwright-core` in a scratch dir; launch with
  `executablePath: '/opt/pw-browsers/chromium'` (do NOT `playwright install`).
- The app needs real video files with finite duration metadata.
  MediaRecorder-produced webm has `duration=Infinity` and breaks `loadMeta` —
  don't use it. Instead render JPEG frames with canvas in the same headless
  Chromium (`canvas.toDataURL('image/jpeg')`), concatenate them into one file,
  and encode with Playwright's trimmed ffmpeg:

  ```bash
  /opt/pw-browsers/ffmpeg-1011/ffmpeg-linux -f image2pipe -c:v mjpeg \
    -framerate 15 -i frames.bin -c:v libvpx -b:v 300k out.webm
  ```

  That ffmpeg build has ONLY: webm mux, matroska/webm + image2pipe demux,
  mjpeg/libvpx codecs, no `pipe:` protocol (write frames to a real file), no
  lavfi, no audio encoders. Make clips of distinct colors/durations so
  timeline proportions and seeks are visually checkable.
- Upload via `page.setInputFiles('input[type=file]', [...])`.
- Page is RTL: the timeline strip flows right-to-left; measure positions from
  the right edge. Timeline segments are `[aria-label^="קטע"]`.

## Flows worth driving

- Upload 2–3 clips → strip widths proportional to durations.
- Click a segment → selects it (ring), seeks (check `span[dir=ltr]` time
  readout), toolbar shows חתוך כאן / מחק קטע + trim sliders.
- Cut / delete / trim / drag-reorder on the strip; crossfade input at 0.
- Watch `page.on('pageerror')` — zustand/React errors surface there.
- Transition smoothness: play across a clip boundary while sampling canvas
  pixels each rAF via `ctx.getImageData` (the moving white bar in the
  generated clips makes stale frames detectable as backward jumps; solid
  colors make black flashes detectable). Note: tiny local VP8 clips decode
  near-instantly, so decoder-latency glitches reproduce weaker here than on
  phone H.264 footage.
