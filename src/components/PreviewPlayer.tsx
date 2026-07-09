import { useEffect, useRef, useState } from 'react';
import { useEditorStore, FORMAT_DIMENSIONS } from '../state/store';
import { buildTimeline } from '../lib/timeline';
import { Compositor } from '../lib/compositor';

// The live preview is only ever shown shrunk on screen (max 60vh), so
// compositing it at full export resolution every animation frame wastes
// GPU/CPU and causes stutter on phones. Cap the canvas backing store while
// keeping the exact aspect ratio; subtitleRender.ts already sizes text
// relative to canvas dimensions, so nothing looks different, just lighter.
const PREVIEW_MAX_DIM = 480;

function previewDims(w: number, h: number) {
  const scale = Math.min(1, PREVIEW_MAX_DIM / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export function PreviewPlayer() {
  const clips = useEditorStore((s) => s.clips);
  const crossfade = useEditorStore((s) => s.crossfade);
  const subtitles = useEditorStore((s) => s.subtitles);
  const subtitleStyle = useEditorStore((s) => s.subtitleStyle);
  const format = useEditorStore((s) => s.format);
  const setFormat = useEditorStore((s) => s.setFormat);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const seekRequest = useEditorStore((s) => s.seekRequest);
  const consumeSeekRequest = useEditorStore((s) => s.consumeSeekRequest);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const stateRef = useRef({ clips, crossfade, subtitles, subtitleStyle });
  stateRef.current = { clips, crossfade, subtitles, subtitleStyle };

  const lastPlayheadPush = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [debugInfo, setDebugInfo] = useState('');
  const dims = FORMAT_DIMENSIONS[format];

  const preview = previewDims(dims.w, dims.h);

  useEffect(() => {
    if (!canvasRef.current) return;
    const compositor = new Compositor({
      canvas: canvasRef.current,
      width: preview.w,
      height: preview.h,
      getSegments: () => buildTimeline(stateRef.current.clips, stateRef.current.crossfade),
      getCues: () => stateRef.current.subtitles,
      getStyle: () => stateRef.current.subtitleStyle,
      onTime: (time, dur) => {
        setT(time);
        setDuration(dur);
        const now = performance.now();
        if (now - lastPlayheadPush.current > 120) {
          lastPlayheadPush.current = now;
          setPlayhead(time);
        }
      },
      onEnded: () => setPlaying(false),
    });
    compositorRef.current = compositor;
    compositor.seek(0);
    return () => compositor.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.w, preview.h]);

  useEffect(() => {
    compositorRef.current?.seek(compositorRef.current.currentTime);
  }, [clips, crossfade, subtitles, subtitleStyle]);

  useEffect(() => {
    if (seekRequest == null) return;
    compositorRef.current?.seek(seekRequest);
    setT(seekRequest);
    consumeSeekRequest();
  }, [seekRequest, consumeSeekRequest]);

  // Temporary on-screen diagnostic readout for tracking down mobile playback
  // issues — polls independently of the compositor's own rAF loop (via
  // setInterval, not requestAnimationFrame) specifically so it keeps
  // reporting state even if the animation loop itself is the thing that's
  // stuck.
  useEffect(() => {
    const id = setInterval(() => {
      const info = compositorRef.current?.getDebugInfo();
      if (!info) return;
      setDebugInfo(
        `playing=${info.playing} t=${info.t.toFixed(2)} ticks=${info.tickCount} err=${info.lastError ?? '-'}\n` +
          info.videos
            .map((v) => `#${v.id} ready=${v.readyState} net=${v.networkState} paused=${v.paused} ct=${v.currentTime} stale=${v.staleTicks} err=${v.error ?? '-'}`)
            .join('\n')
      );
    }, 300);
    return () => clearInterval(id);
  }, []);

  function togglePlay() {
    const c = compositorRef.current;
    if (!c) return;
    if (c.isPlaying()) {
      c.pause();
      setPlaying(false);
    } else {
      c.play();
      setPlaying(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">תצוגה מקדימה</h2>
        <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 text-xs">
          {(Object.keys(FORMAT_DIMENSIONS) as (keyof typeof FORMAT_DIMENSIONS)[]).map((key) => (
            <button
              key={key}
              onClick={() => setFormat(key)}
              className={`rounded px-2 py-1 ${format === key ? 'bg-accent text-black font-medium' : 'text-muted hover:text-text'}`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div
        className="mx-auto flex items-center justify-center overflow-hidden rounded-xl border border-border bg-black"
        style={{ aspectRatio: `${dims.w}/${dims.h}`, maxHeight: '60vh', width: dims.w >= dims.h ? '100%' : 'auto' }}
      >
        {clips.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">העלו סרטונים כדי להתחיל</p>
        ) : (
          <canvas ref={canvasRef} className="h-full max-h-[60vh] w-auto" />
        )}
      </div>

      {clips.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-black"
            aria-label={playing ? 'השהה' : 'נגן'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={t}
            onChange={(e) => compositorRef.current?.seek(Number(e.target.value))}
            className="flex-1"
          />
          <span dir="ltr" className="w-20 shrink-0 text-xs text-muted tabular-nums">
            {fmt(t)} / {fmt(duration)}
          </span>
        </div>
      )}

      {clips.length > 0 && debugInfo && (
        <pre dir="ltr" className="whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-2 text-[10px] text-muted">
          {debugInfo}
        </pre>
      )}
    </div>
  );
}
