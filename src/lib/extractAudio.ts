import type { Clip } from './types';

const TARGET_SAMPLE_RATE = 16000;

async function decodeClipMono(clip: Clip, ctx: AudioContext): Promise<Float32Array> {
  const buf = await clip.file.arrayBuffer();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  const startSample = Math.floor(clip.trimStart * decoded.sampleRate);
  const endSample = Math.min(decoded.length, Math.ceil(clip.trimEnd * decoded.sampleRate));
  const length = Math.max(0, endSample - startSample);
  const mono = new Float32Array(length);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[startSample + i] / decoded.numberOfChannels;
    }
  }
  return resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    output[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return output;
}

/**
 * Concatenates every clip's trimmed audio, back to back, ignoring crossfade
 * overlap (good enough for speech recognition; exact sync is fixed up
 * manually afterwards in the subtitle list).
 */
export async function extractMergedAudio(clips: Clip[]): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const parts = await Promise.all(clips.map((c) => decodeClipMono(c, ctx)));
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  } finally {
    ctx.close();
  }
}

export const WHISPER_SAMPLE_RATE = TARGET_SAMPLE_RATE;
