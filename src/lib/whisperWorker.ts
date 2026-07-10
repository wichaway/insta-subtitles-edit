/// <reference lib="webworker" />
import { pipeline, env } from '@xenova/transformers';
import { groupIntoCues } from './cueGrouping';

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
    const cues = groupIntoCues(chunks.map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] })));
    postMessage({ type: 'done', cues });
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

