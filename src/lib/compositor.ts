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

const SEEK_DRIFT_TOLERANCE = 0.25;

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
  private audioDestination: AudioNode | null = null;
  private audioNodes = new Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>();
  private tickCount = 0;
  private lastError: string | null = null;
  // Counts genuinely new decoded frames per clip via requestVideoFrameCallback
  // (NOT currentTime — that's a continuously-advancing presentation clock and
  // keeps moving even when the decoder hasn't produced a new frame yet, so
  // comparing currentTime between ticks can't actually detect stale-frame
  // redraws). Comparing this counter's growth rate to tickCount's tells us
  // whether the video's own decode is keeping up with the draw loop.
  private presentedFrames = new Map<string, number>();

  constructor(opts: CompositorOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.canvas.width = opts.width;
    this.canvas.height = opts.height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.container = document.createElement('div');
    // iOS Safari suppresses video frame decoding entirely for elements it
    // considers invisible — measured on-device: with the videos in a
    // 1x1px clipped box, requestVideoFrameCallback reported exactly ONE
    // presented frame across 12s of "playback" (the media clock advanced,
    // no frames were decoded, canvas stayed black). opacity:0 and
    // off-screen positioning fail the same way. The only reliable shape is
    // making the videos genuinely visible at real size: park them directly
    // BEHIND the canvas (same box, lower stacking order). Occlusion by the
    // canvas doesn't count as invisible to WebKit's heuristics, and the
    // canvas paints an opaque black background every frame, so the raw
    // videos never actually show through.
    const parent = this.canvas.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      this.container.style.cssText =
        'position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;';
      this.canvas.style.position = 'relative';
      this.canvas.style.zIndex = '1';
      parent.insertBefore(this.container, this.canvas);
    } else {
      // Detached canvas (shouldn't normally happen — the exporter mounts
      // its canvas on-screen for the same visibility reason). Best effort.
      this.container.style.cssText =
        'position:fixed;top:0;left:0;width:100vw;height:100vh;overflow:hidden;opacity:1;pointer-events:none;z-index:-1;';
      document.body.appendChild(this.container);
    }
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

      // iOS Safari ignores preload="auto" and won't decode any frame data
      // until playback actually starts (readyState stays at HAVE_METADATA),
      // which left the preview canvas black until the user pressed play.
      // A muted play→pause (allowed without a user gesture for muted
      // playsinline video) forces the first frame to decode; the
      // 'loadeddata' listener above then paints it.
      const videoEl = el;
      const primeFirstFrame = () => {
        if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
        videoEl
          .play()
          .then(() => {
            if (!this.playing) videoEl.pause();
          })
          .catch(() => {});
      };
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
        primeFirstFrame();
      } else {
        el.addEventListener('loadedmetadata', primeFirstFrame, { once: true });
      }

      this.container.appendChild(el);
      this.videoEls.set(clip.id, el);
      this.wireAudio(clip.id, el);

      if ('requestVideoFrameCallback' in videoEl) {
        this.presentedFrames.set(clip.id, 0);
        const trackFrame = (_now: number, metadata: { presentedFrames: number }) => {
          this.presentedFrames.set(clip.id, metadata.presentedFrames);
          if (this.videoEls.get(clip.id) === videoEl) {
            videoEl.requestVideoFrameCallback(trackFrame);
          }
        };
        videoEl.requestVideoFrameCallback(trackFrame);
      }
    }
    return el;
  }

  /**
   * Routes every clip's audio through a WebAudio graph so we can crossfade
   * volume. For export the destination is a MediaStreamAudioDestinationNode
   * (tapped by MediaRecorder); for the live preview it's the context's
   * speakers destination. Video elements created after this call (clips
   * whose segment first becomes active mid-playback) are wired on creation.
   */
  ensureAudioGraph(audioCtx: AudioContext, destination: AudioNode) {
    this.audioCtx = audioCtx;
    this.audioDestination = destination;
    for (const [id, el] of this.videoEls) {
      this.wireAudio(id, el);
    }
  }

  private wireAudio(clipId: string, el: HTMLVideoElement) {
    if (!this.audioCtx || !this.audioDestination || this.audioNodes.has(clipId)) return;
    el.muted = false;
    const source = this.audioCtx.createMediaElementSource(el);
    const gain = this.audioCtx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.audioDestination);
    this.audioNodes.set(clipId, { source, gain });
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
      // Seek ONLY when the video is meaningfully off-position. The old
      // unconditional "always seek while paused" created an infinite loop
      // (caught via fillRect stack trace): drawFrame assigns currentTime →
      // fires 'seeked' → redrawWhenReady calls drawFrame → assigns
      // currentTime again → ... Each assignment restarts the seek algorithm
      // (readyState drops below HAVE_CURRENT_DATA mid-seek), so the loop
      // both showed black frames while paused and kept the decoder
      // permanently busy seeking.
      const drift = Math.abs(el.currentTime - frame.localTime);
      const tolerance = this.playing ? SEEK_DRIFT_TOLERANCE : 0.01;
      if (drift > tolerance) {
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

    // While playing, slave the compositor clock to the active clip's own
    // media clock instead of letting the two run independently. Two free-
    // running clocks inevitably drift; every time drift crossed the seek
    // tolerance the old code force-seeked the video, and on iOS each seek
    // interrupts the decoder (keyframe jump + re-decode), stalling it so
    // the video fell further behind and got seeked again — a seek storm
    // that capped effective decode at ~4fps on-device (frames=34 over 9s
    // in the debug readout) and showed up as constant judder. With the
    // video as master, drift stays ~0 and playback-time seeks vanish.
    const activeNow = activeFramesAt(this.opts.getSegments(), this.t);
    const primary = activeNow[0];
    if (primary) {
      const el = this.videoEls.get(primary.segment.clip.id);
      if (el && !el.paused && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const videoT = primary.segment.globalStart + (el.currentTime - primary.segment.clip.trimStart);
        // Only adopt the video clock when it broadly agrees with ours —
        // right after a segment transition the element may not have
        // started playing from its in-point yet.
        if (Math.abs(videoT - this.t) < 0.5) {
          this.t = videoT;
        }
      }
    }

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
    // Gesture-activate every clip's media element while still inside the
    // user's tap: iOS only allows unmuted playback for elements whose
    // play() was first called from a user gesture, and clips further down
    // the timeline would otherwise get their first play() from the rAF
    // loop. Inactive clips are paused again by the next drawFrame, and
    // their gains sit at 0, so nothing is heard from them.
    for (const seg of this.opts.getSegments()) {
      const el = this.getVideoEl(seg.clip);
      if (el.paused) el.play().catch(() => {});
    }
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
        presentedFrames: this.presentedFrames.get(id) ?? -1,
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
    this.presentedFrames.clear();
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
