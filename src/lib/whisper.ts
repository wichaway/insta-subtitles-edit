import type { SubtitleCue } from './types';

export type WhisperModel = 'base' | 'small';

interface RunOptions {
  audio: Float32Array;
  model: WhisperModel;
  language: string | null;
  onProgress: (fraction: number, status: 'loading-model' | 'transcribing') => void;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function transcribe(opts: RunOptions): Promise<SubtitleCue[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'progress') {
        opts.onProgress(data.progress, 'loading-model');
      } else if (data.type === 'status') {
        opts.onProgress(0, data.status);
      } else if (data.type === 'done') {
        const cues: SubtitleCue[] = data.cues.map((c: { text: string; start: number; end: number }) => ({
          id: makeId(),
          text: c.text,
          start: c.start,
          end: c.end,
        }));
        worker.terminate();
        resolve(cues);
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ audio: opts.audio, model: opts.model, language: opts.language });
  });
}
