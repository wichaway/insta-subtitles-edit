import type { Clip, TimelineSegment } from './types';

export function clipDuration(clip: Clip): number {
  return Math.max(0, clip.trimEnd - clip.trimStart);
}

/**
 * Lays clips end to end, each overlapping the previous by `crossfade` seconds
 * (clamped to each clip's own duration so a short clip can never produce a
 * negative-length segment).
 */
export function buildTimeline(clips: Clip[], crossfade: number): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  clips.forEach((clip, i) => {
    const dur = clipDuration(clip);
    const overlap = i === 0 ? 0 : Math.min(crossfade, dur, clipDuration(clips[i - 1]));
    const start = i === 0 ? 0 : cursor - overlap;
    const end = start + dur;
    segments.push({ clip, clipIndex: i, globalStart: start, globalEnd: end });
    cursor = end;
  });
  return segments;
}

export function totalDuration(segments: TimelineSegment[]): number {
  if (segments.length === 0) return 0;
  return segments[segments.length - 1].globalEnd;
}

export interface ActiveFrame {
  segment: TimelineSegment;
  /** Time within the source clip (already offset by trimStart), seconds. */
  localTime: number;
  /** 1 = fully opaque, used to crossfade into the next segment. */
  alpha: number;
}

function frameFor(seg: TimelineSegment, t: number, alpha: number): ActiveFrame {
  const localTime = seg.clip.trimStart + (t - seg.globalStart);
  return {
    segment: seg,
    localTime: Math.min(Math.max(localTime, seg.clip.trimStart), seg.clip.trimEnd),
    alpha,
  };
}

/**
 * Returns the segment(s) active at global time `t`, ordered back-to-front
 * (draw index 0 first, later entries on top) so a simple alpha-blended
 * canvas draw produces a crossfade during overlap windows.
 */
export function activeFramesAt(segments: TimelineSegment[], t: number): ActiveFrame[] {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (t < seg.globalStart - 1e-6 || t > seg.globalEnd + 1e-6) continue;
    const next = segments[i + 1];
    if (next && t >= next.globalStart) {
      const span = seg.globalEnd - next.globalStart;
      const outAlpha = span > 0 ? 1 - (t - next.globalStart) / span : 0;
      return [frameFor(next, t, 1), frameFor(seg, t, outAlpha)];
    }
    return [frameFor(seg, t, 1)];
  }
  return [];
}

export function findCueAt(cues: { start: number; end: number }[], t: number) {
  return cues.filter((c) => t >= c.start && t < c.end);
}
