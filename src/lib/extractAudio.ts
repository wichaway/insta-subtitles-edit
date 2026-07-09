import { fetchFile } from '@ffmpeg/util';
import type { Clip } from './types';
import { getFFmpeg } from './transcodeMp4';

const TARGET_SAMPLE_RATE = 16000;

function extOf(file: File): string {
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 ? file.name.slice(dot + 1) : 'mp4';
}

/**
 * Extracts a clip's trimmed audio as mono 16kHz PCM via FFmpeg rather than
 * AudioContext.decodeAudioData: decodeAudioData's support for demuxing audio
 * out of arbitrary video containers is inconsistent on mobile browsers (it's
 * primarily meant for audio files) and was failing outright on Android
 * Chrome. FFmpeg has proper codec/container support and also handles the
 * trim + resample in one pass.
 */
async function decodeClipMono(clip: Clip): Promise<Float32Array> {
  const ffmpeg = await getFFmpeg();
  const inputName = `extract-in.${extOf(clip.file)}`;
  const outputName = 'extract-out.pcm';
  await ffmpeg.writeFile(inputName, await fetchFile(clip.file));
  try {
    await ffmpeg.exec([
      '-i', inputName,
      '-ss', clip.trimStart.toString(),
      '-to', clip.trimEnd.toString(),
      '-ar', String(TARGET_SAMPLE_RATE),
      '-ac', '1',
      '-f', 'f32le',
      outputName,
    ]);
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    // Copy into a fresh buffer: the FS buffer's byteOffset may not be 4-byte
    // aligned, which Float32Array requires.
    const floatCount = Math.floor(data.length / 4);
    const aligned = new Uint8Array(floatCount * 4);
    aligned.set(data.subarray(0, floatCount * 4));
    return new Float32Array(aligned.buffer);
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

/**
 * Concatenates every clip's trimmed audio, back to back, ignoring crossfade
 * overlap (good enough for speech recognition; exact sync is fixed up
 * manually afterwards in the subtitle list).
 */
export async function extractMergedAudio(clips: Clip[]): Promise<Float32Array> {
  const parts: Float32Array[] = [];
  for (const c of clips) {
    parts.push(await decodeClipMono(c));
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export const WHISPER_SAMPLE_RATE = TARGET_SAMPLE_RATE;
