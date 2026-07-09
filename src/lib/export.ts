import { Compositor } from './compositor';
import type { SubtitleCue, SubtitleStyle, TimelineSegment } from './types';

interface RenderOptions {
  width: number;
  height: number;
  segments: TimelineSegment[];
  cues: SubtitleCue[];
  style: SubtitleStyle;
  onProgress: (fraction: number) => void;
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? 'video/webm';
}

export async function renderToWebm(opts: RenderOptions): Promise<Blob> {
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

  const recorder = new MediaRecorder(combined, {
    mimeType: pickMimeType(),
    videoBitsPerSecond: 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
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
  return blob;
}
