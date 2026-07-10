export interface TimedWord {
  text: string;
  start: number;
  /** May be null when the recognizer couldn't time the word's end. */
  end: number | null;
}

const MAX_WORDS = 7;
const MAX_SPAN = 4.2;

/** Groups word-level timestamps into readable subtitle cues (~7 words / ~4.2s per cue). */
export function groupIntoCues(words: TimedWord[]): { text: string; start: number; end: number }[] {
  const cues: { text: string; start: number; end: number }[] = [];
  let bucket: TimedWord[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    const start = bucket[0].start;
    const last = bucket[bucket.length - 1];
    const end = last.end ?? last.start + 0.5;
    cues.push({ text: bucket.map((w) => w.text.trim()).join(' ').trim(), start, end });
    bucket = [];
  };

  for (const w of words) {
    if (w.start == null) continue;
    const bucketStart = bucket[0]?.start ?? w.start;
    const wouldSpan = (w.end ?? w.start) - bucketStart;
    if (bucket.length >= MAX_WORDS || wouldSpan > MAX_SPAN || /[.!?…]$/.test(bucket[bucket.length - 1]?.text ?? '')) {
      flush();
    }
    bucket.push(w);
  }
  flush();
  return cues;
}
