import type { SubtitleCue } from './types';
import { groupIntoCues } from './cueGrouping';
import { WHISPER_SAMPLE_RATE } from './extractAudio';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// Dev-server proxy fallback (see vite.config.ts) in case the direct
// cross-origin call is blocked in some browser/CORS combination.
const GROQ_PROXY_URL = '/groq/openai/v1/audio/transcriptions';
// Full large-v3, not the turbo variant: turbo trades multilingual accuracy
// for speed and is noticeably weaker on Hebrew. Both are on Groq's free tier.
const MODEL = 'whisper-large-v3';

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqSegment {
  start: number;
  end: number;
  text: string;
}

interface GroqResponse {
  text: string;
  words?: GroqWord[];
  segments?: GroqSegment[];
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Encodes mono float32 PCM as a 16-bit WAV blob (what the API expects). */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export interface GroqOptions {
  audio: Float32Array;
  apiKey: string;
  /** ISO-639-1 code ('he', 'en') or null for auto-detect. */
  language: string | null;
}

export async function transcribeWithGroq(opts: GroqOptions): Promise<SubtitleCue[]> {
  const wav = encodeWav(opts.audio, WHISPER_SAMPLE_RATE);

  const form = new FormData();
  form.append('file', new File([wav], 'audio.wav', { type: 'audio/wav' }));
  form.append('model', MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  if (opts.language) form.append('language', opts.language);

  const headers = { Authorization: `Bearer ${opts.apiKey}` };
  let res: Response;
  try {
    res = await fetch(GROQ_URL, { method: 'POST', headers, body: form });
  } catch {
    // Network/CORS failure on the direct call — retry through the dev proxy.
    res = await fetch(GROQ_PROXY_URL, { method: 'POST', headers, body: form });
  }

  if (!res.ok) {
    let message = `Groq API ${res.status}`;
    try {
      const err = await res.json();
      message = err?.error?.message ?? message;
    } catch {
      /* keep the status-based message */
    }
    throw new Error(message);
  }

  const data = (await res.json()) as GroqResponse;

  const grouped =
    data.words && data.words.length > 0
      ? groupIntoCues(data.words.map((w) => ({ text: w.word, start: w.start, end: w.end })))
      : (data.segments ?? []).map((s) => ({ text: s.text.trim(), start: s.start, end: s.end }));

  return grouped
    .filter((c) => c.text.length > 0)
    .map((c) => ({ id: makeId(), text: c.text, start: c.start, end: c.end }));
}
