import { useState } from 'react';
import { useEditorStore, FORMAT_DIMENSIONS } from '../state/store';
import { buildTimeline, totalDuration } from '../lib/timeline';
import { renderToWebm } from '../lib/export';
import { webmToMp4 } from '../lib/transcodeMp4';

type Stage = 'idle' | 'rendering' | 'converting' | 'done' | 'error';

export function ExportPanel() {
  const clips = useEditorStore((s) => s.clips);
  const crossfade = useEditorStore((s) => s.crossfade);
  const subtitles = useEditorStore((s) => s.subtitles);
  const subtitleStyle = useEditorStore((s) => s.subtitleStyle);
  const format = useEditorStore((s) => s.format);

  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [mp4, setMp4] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const segments = buildTimeline(clips, crossfade);
  const duration = totalDuration(segments);
  const dims = FORMAT_DIMENSIONS[format];

  async function handleExport() {
    setError(null);
    setUrl(null);
    try {
      setStage('rendering');
      setProgress(0);
      const webm = await renderToWebm({
        width: dims.w,
        height: dims.h,
        segments,
        cues: subtitles,
        style: subtitleStyle,
        onProgress: setProgress,
      });

      let finalBlob: Blob = webm;
      if (mp4) {
        setStage('converting');
        setProgress(0);
        finalBlob = await webmToMp4(webm, setProgress);
      }
      setUrl(URL.createObjectURL(finalBlob));
      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בייצוא הסרטון');
      setStage('error');
    }
  }

  const busy = stage === 'rendering' || stage === 'converting';

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">ייצוא</h2>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={mp4} onChange={(e) => setMp4(e.target.checked)} disabled={busy} />
        המרה ל-MP4 (מומלץ לשיתוף באינסטגרם/וואטסאפ)
      </label>

      <button
        onClick={handleExport}
        disabled={clips.length === 0 || busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {busy ? 'מייצא…' : `⬇ ייצוא סרטון (${duration.toFixed(1)} שנ')`}
      </button>

      {busy && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(4, progress * 100)}%` }} />
          </div>
          <p className="text-[11px] text-muted">
            {stage === 'rendering' ? 'מרנדר את הסרטון (משך זמן אמת)…' : 'ממיר ל-MP4…'}
          </p>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {url && stage === 'done' && (
        <a
          href={url}
          download={mp4 ? 'video.mp4' : 'video.webm'}
          className="rounded-lg border border-accent px-4 py-2 text-center text-sm font-medium text-accent hover:bg-accent-soft"
        >
          הורדת הסרטון המוכן
        </a>
      )}
    </section>
  );
}
