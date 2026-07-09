import { FFFSType } from '@ffmpeg/ffmpeg';
import type { Clip } from './types';
import { getFFmpeg } from './transcodeMp4';

const TARGET_SAMPLE_RATE = 16000;

let mountSeq = 0;

function extOf(file: File): string {
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 ? file.name.slice(dot + 1) : 'mp4';
}

/**
 * Extracts a clip's trimmed audio as mono 16kHz PCM via FFmpeg rather than
 * AudioContext.decodeAudioData (whose video-container demuxing support is
 * unreliable on mobile browsers and failed outright on-device).
 *
 * The source file is mounted via WORKERFS instead of being copied into the
 * WASM filesystem: phone-recorded clips run hundreds of MB, and the copy
 * (whole-file ArrayBuffer + a second copy in the FS) blew Safari's per-tab
 * memory limit, crashing and reloading the page mid-transcription. WORKERFS
 * lets FFmpeg read the File directly with no up-front copy. -vn skips the
 * video stream entirely, so only audio packets are ever decoded.
 */
async function decodeClipMono(clip: Clip): Promise<Float32Array> {
  const ffmpeg = await getFFmpeg();
  const seq = mountSeq++;
  const mountDir = `/mnt-audio-${seq}`;
  const outputName = `extract-out-${seq}.pcm`;
  // Cheap blob wrapper (no data copy) with a predictable ASCII name, so the
  // FS path is safe regardless of the original filename.
  const input = new File([clip.file], `input-${seq}.${extOf(clip.file)}`, { type: clip.file.type });

  await ffmpeg.createDir(mountDir);
  await ffmpeg.mount(FFFSType.WORKERFS, { files: [input] }, mountDir);
  try {
    await ffmpeg.exec([
      '-i', `${mountDir}/${input.name}`,
      '-ss', clip.trimStart.toString(),
      '-to', clip.trimEnd.toString(),
      '-vn',
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
    await ffmpeg.deleteFile(outputName).catch(() => {});
    await ffmpeg.unmount(mountDir).catch(() => {});
    await ffmpeg.deleteDir(mountDir).catch(() => {});
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
