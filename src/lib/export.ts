import { Compositor } from './compositor';
import type { SubtitleCue, SubtitleStyle, TimelineSegment } from './types';

interface RenderOptions {
  width: number;
  height: number;
  segments: TimelineSegment[];
  cues: SubtitleCue[];
  style: SubtitleStyle;
  onProgress: (fraction: number) => void;
  /** When true, prefer recording MP4 natively (hardware-encoded) over WebM. */
  preferMp4: boolean;
}

interface RecordResult {
  blob: Blob;
  mimeType: string;
}

function pickMimeType(preferMp4: boolean): string {
  // Where supported (recent Chrome/Safari on mobile), MediaRecorder can
  // record MP4 directly using the phone's hardware encoder — dramatically
  // faster and lighter than the FFmpeg/libx264 WASM software encode we'd
  // otherwise need to run afterwards to get an MP4.
  const mp4Candidates = ['video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=h264,aac', 'video/mp4'];
  const webmCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const candidates = preferMp4 ? [...mp4Candidates, ...webmCandidates] : webmCandidates;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? 'video/webm';
}

/**
 * Rendering runs in real time via canvas.captureStream + MediaRecorder, so
 * the tab must stay foregrounded for the full clip duration. Mobile browsers
 * suspend background-tab timers on screen lock, which hangs the export
 * indefinitely — holding a wake lock keeps the screen (and the tab) alive.
 * Requires a secure context (HTTPS or localhost); silently no-ops otherwise.
 */
async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  if (!('wakeLock' in navigator)) return null;
  try {
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}

export async function renderVideo(opts: RenderOptions): Promise<RecordResult> {
  const wakeLock = await acquireWakeLock();
  try {
    return await record(opts);
  } finally {
    await wakeLock?.release().catch(() => {});
  }
}

async function record(opts: RenderOptions): Promise<RecordResult> {
  const canvas = document.createElement('canvas');
  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();

  const compositor = new Compositor({
    canvas,
    width: opts.width,
    height: opts.height,
    getSegments: () => opts.segments,
    getCues: () => opts.cues,
    getStyle: () => opts.style,
    onTime: (t, duration) => opts.onProgress(duration > 0 ? t / duration : 0),
  });

  // Force-create every clip's <video> element before wiring the audio graph.
  for (const seg of opts.segments) {
    compositor.renderAt(seg.globalStart);
  }
  compositor.ensureAudioGraph(audioCtx, destination);

  const videoStream = canvas.captureStream(30);
  const combined = new MediaStream([...videoStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);

  const mimeType = pickMimeType(opts.preferMp4);
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  compositor.seek(0);
  recorder.start(250);
  compositor.play();

  await new Promise<void>((resolve) => {
    const check = () => {
      if (!compositor.isPlaying()) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  });

  recorder.stop();
  const blob = await done;
  compositor.destroy();
  audioCtx.close();
  return { blob, mimeType };
}
