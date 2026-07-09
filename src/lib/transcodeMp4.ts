import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

export async function webmToMp4(webm: Blob, onProgress: (fraction: number) => void): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  ffmpeg.on('progress', ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))));

  await ffmpeg.writeFile('input.webm', await fetchFile(webm));
  await ffmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'output.mp4']);
  const data = (await ffmpeg.readFile('output.mp4')) as Uint8Array;
  await ffmpeg.deleteFile('input.webm');
  await ffmpeg.deleteFile('output.mp4');
  return new Blob([data.slice()], { type: 'video/mp4' });
}
