export interface Clip {
  id: string;
  file: File;
  url: string;
  name: string;
  /** Full duration of the source file, seconds. */
  duration: number;
  /** In-point within the source file, seconds. */
  trimStart: number;
  /** Out-point within the source file, seconds. */
  trimEnd: number;
  width: number;
  height: number;
}

export interface SubtitleCue {
  id: string;
  text: string;
  /** Start time on the merged timeline, seconds. */
  start: number;
  /** End time on the merged timeline, seconds. */
  end: number;
}

export type SubtitlePosition = 'bottom' | 'top' | 'center' | 'custom';

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  outline: boolean;
  bold: boolean;
  position: SubtitlePosition;
  /** Relative 0-1 anchor, used when position === 'custom'. */
  x: number;
  y: number;
  maxWidth: number;
}

export interface TimelineSegment {
  clip: Clip;
  clipIndex: number;
  /** Start of this clip's contribution on the merged timeline, seconds. */
  globalStart: number;
  /** End of this clip's contribution on the merged timeline, seconds. */
  globalEnd: number;
}

export type TranscribeStatus =
  | 'idle'
  | 'loading-model'
  | 'transcribing'
  | 'done'
  | 'error';
