/// <reference lib="webworker" />
import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;

type ModelSize = 'base' | 'small';

let currentPipeline: unknown = null;
let currentModel: ModelSize | null = null;

async function loadPipeline(model: ModelSize) {
  if (currentPipeline && currentModel === model) return currentPipeline;
  currentPipeline = await pipeline('automatic-speech-recognition', `Xenova/whisper-${model}`, {
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        postMessage({ type: 'progress', progress: p.progress / 100 });
      }
    },
  });
  currentModel = model;
  return currentPipeline;
}

self.onmessage = async (e: MessageEvent) => {
  const { audio, model, language } = e.data as {
    audio: Float32Array;
    model: ModelSize;
    language: string | null;
  };
  try {
    postMessage({ type: 'status', status: 'loading-model' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transcriber = (await loadPipeline(model)) as any;

    postMessage({ type: 'status', status: 'transcribing' });
    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: language ?? undefined,
      task: 'transcribe',
      return_timestamps: 'word',
    });

    const chunks: { text: string; timestamp: [number, number | null] }[] = result.chunks ?? [];
    const cues = groupIntoCues(chunks);
    postMessage({ type: 'done', cues });
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

/** Groups word-level timestamps into readable subtitle cues (~6 words / ~4s per cue). */
function groupIntoCues(words: { text: string; timestamp: [number, number | null] }[]) {
  const cues: { text: string; start: number; end: number }[] = [];
  const MAX_WORDS = 7;
  const MAX_SPAN = 4.2;
  let bucket: typeof words = [];

  const flush = () => {
    if (bucket.length === 0) return;
    const start = bucket[0].timestamp[0];
    const last = bucket[bucket.length - 1];
    const end = last.timestamp[1] ?? last.timestamp[0] + 0.5;
    cues.push({ text: bucket.map((w) => w.text.trim()).join(' ').trim(), start, end });
    bucket = [];
  };

  for (const w of words) {
    if (w.timestamp[0] == null) continue;
    const bucketStart = bucket[0]?.timestamp[0] ?? w.timestamp[0];
    const wouldSpan = (w.timestamp[1] ?? w.timestamp[0]) - bucketStart;
    if (bucket.length >= MAX_WORDS || wouldSpan > MAX_SPAN || /[.!?…]$/.test(bucket[bucket.length - 1]?.text ?? '')) {
      flush();
    }
    bucket.push(w);
  }
  flush();
  return cues;
}
