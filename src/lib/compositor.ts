import type { Clip, SubtitleCue, SubtitleStyle, TimelineSegment } from './types';
import { activeFramesAt, totalDuration } from './timeline';
import { drawSubtitle } from './subtitleRender';

interface CompositorOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  getSegments: () => TimelineSegment[];
  getCues: () => SubtitleCue[];
  getStyle: () => SubtitleStyle;
  onTime?: (t: number, duration: number) => void;
  onEnded?: () => void;
}

const SEEK_DRIFT_TOLERANCE = 0.12;

export class Compositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: CompositorOptions;
  private videoEls = new Map<string, HTMLVideoElement>();
  private container: HTMLDivElement;
  private rafId: number | null = null;
  private lastTs = 0;
  private t = 0;
  private playing = false;
  private audioCtx: AudioContext | null = null;
  private audioNodes = new Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>();
  private tickCount = 0;
  private lastError: string | null = null;

  constructor(opts: CompositorOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.canvas.width = opts.width;
    this.canvas.height = opts.height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.container = document.createElement('div');
    // Kept within viewport bounds (top:0/left:0) and hidden via opacity, NOT
    // pushed far off-screen: mobile Chrome defers loading video data for
    // elements it judges "too far off-screen to ever be seen" to save
    // battery/data, which starves the canvas draw of frames entirely.
    // opacity:0 still intersects the viewport so that heuristic doesn't
    // kick in, while width:0/height:0 elements separately get decode-rate
    // throttled for being zero-size — real size + opacity:0 avoids both.
    this.container.style.cssText = 'position:fixed;top:0;left:0;opacity:0;overflow:visible;pointer-events:none;';
    document.body.appendChild(this.container);
  }

  get duration() {
    return totalDuration(this.opts.getSegments());
  }

  get currentTime() {
    return this.t;
  }

  private getVideoEl(clip: Clip): HTMLVideoElement {
    let el = this.videoEls.get(clip.id);
    if (!el) {
      el = document.createElement('video');
      el.src = clip.url;
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.width = clip.width;
      el.height = clip.height;
      const redrawWhenReady = () => {
        if (!this.playing) this.drawFrame();
      };
      el.addEventListener('loadeddata', redrawWhenReady);
      el.addEventListener('seeked', redrawWhenReady);
      this.container.appendChild(el);
      this.videoEls.set(clip.id, el);
    }
    return el;
  }

  /** Routes every clip's audio through a WebAudio graph so we can crossfade volume and, for export, tap a MediaStream. */
  ensureAudioGraph(audioCtx: AudioContext, destination: MediaStreamAudioDestinationNode) {
    this.audioCtx = audioCtx;
    for (const [id, el] of this.videoEls) {
      if (this.audioNodes.has(id)) continue;
      el.muted = false;
      const source = audioCtx.createMediaElementSource(el);
      const gain = audioCtx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(destination);
      this.audioNodes.set(id, { source, gain });
    }
  }

  private setVolume(clipId: string, alpha: number) {
    const nodes = this.audioNodes.get(clipId);
    if (nodes && this.audioCtx) {
      nodes.gain.gain.setTargetAtTime(alpha, this.audioCtx.currentTime, 0.01);
    }
  }

  private drawFrame() {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const segments = this.opts.getSegments();
    const frames = activeFramesAt(segments, this.t);
    const activeIds = new Set(frames.map((f) => f.segment.clip.id));

    for (const [id, el] of this.videoEls) {
      if (!activeIds.has(id) && !el.paused) {
        el.pause();
        this.setVolume(id, 0);
      }
    }

    for (const frame of frames) {
      const clip = frame.segment.clip;
      const el = this.getVideoEl(clip);
      const drift = Math.abs(el.currentTime - frame.localTime);
      if (!this.playing || drift > SEEK_DRIFT_TOLERANCE || el.paused) {
        try {
          el.currentTime = frame.localTime;
        } catch {
          /* ignore seeks before metadata is ready */
        }
      }
      if (this.playing && el.paused) {
        el.play().catch(() => {});
      }
      if (!this.playing && !el.paused) {
        el.pause();
      }
      this.setVolume(clip.id, frame.alpha);

      // ctx.drawImage() throws if a <video>'s readyState is below
      // HAVE_CURRENT_DATA (2) — happens routinely right after a video
      // element is created or right at a clip transition. Left unguarded,
      // that throw aborts drawFrame() before it returns, which (when called
      // from the rAF loop in tick()) skips the requestAnimationFrame call
      // that reschedules the next frame — permanently freezing playback
      // from one transient hiccup.
      if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        ctx.globalAlpha = frame.alpha;
        drawContain(ctx, el, clip.width, clip.height, canvas.width, canvas.height);
      }
    }
    ctx.globalAlpha = 1;

    const style = this.opts.getStyle();
    const cues = this.opts
      .getCues()
      .filter((c) => this.t >= c.start && this.t < c.end);
    for (const cue of cues) {
      drawSubtitle(ctx, cue.text, style, canvas.width, canvas.height);
    }
  }

  private tick = (ts: number) => {
    if (!this.playing) return;
    this.tickCount++;
    const dt = this.lastTs ? (ts - this.lastTs) / 1000 : 0;
    this.lastTs = ts;
    this.t += dt;
    const dur = this.duration;
    const ended = this.t >= dur;
    if (ended) this.t = dur;

    // Belt-and-suspenders: whatever happens inside drawFrame(), never let it
    // stop the rAF loop from rescheduling below — a single bad frame should
    // never permanently freeze playback.
    try {
      this.drawFrame();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error('Compositor: skipping a frame after draw error', err);
    }

    if (ended) {
      this.pause();
      this.opts.onEnded?.();
      this.opts.onTime?.(this.t, dur);
      return;
    }
    this.opts.onTime?.(this.t, dur);
    this.rafId = requestAnimationFrame(this.tick);
  };

  play() {
    if (this.playing) return;
    this.playing = true;
    this.lastTs = 0;
    this.audioCtx?.resume();
    this.rafId = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    for (const [id, el] of this.videoEls) {
      el.pause();
      this.setVolume(id, 0);
    }
  }

  seek(t: number) {
    this.t = Math.min(Math.max(0, t), this.duration);
    try {
      this.drawFrame();
    } catch (err) {
      console.error('Compositor: draw error during seek', err);
    }
    this.opts.onTime?.(this.t, this.duration);
  }

  isPlaying() {
    return this.playing;
  }

  /** Snapshot of internal state for the on-screen debug readout. */
  getDebugInfo() {
    return {
      playing: this.playing,
      t: this.t,
      tickCount: this.tickCount,
      lastError: this.lastError,
      videos: Array.from(this.videoEls.entries()).map(([id, el]) => ({
        id: id.slice(0, 6),
        readyState: el.readyState,
        paused: el.paused,
        currentTime: Number(el.currentTime.toFixed(2)),
        networkState: el.networkState,
        error: el.error?.message ?? null,
      })),
    };
  }

  /** Renders exactly one frame at the given time without touching playback state — used by the exporter. */
  renderAt(t: number) {
    this.t = t;
    this.drawFrame();
  }

  destroy() {
    this.pause();
    this.videoEls.forEach((el) => el.remove());
    this.videoEls.clear();
    this.audioNodes.clear();
    this.container.remove();
  }
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
) {
  if (!srcW || !srcH) return;
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  const x = (dstW - w) / 2;
  const y = (dstH - h) / 2;
  ctx.drawImage(media, x, y, w, h);
}
