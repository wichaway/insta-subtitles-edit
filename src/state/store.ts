import { create } from 'zustand';
import type { Clip, SubtitleCue, SubtitleStyle, TranscribeStatus } from '../lib/types';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export const defaultSubtitleStyle: SubtitleStyle = {
  fontFamily: 'Rubik',
  fontSize: 5.5,
  color: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.55,
  outline: true,
  bold: true,
  position: 'bottom',
  x: 0.5,
  y: 0.88,
  maxWidth: 0.86,
};

export type Format = '9:16' | '1:1' | '16:9';

export const FORMAT_DIMENSIONS: Record<Format, { w: number; h: number; label: string }> = {
  '9:16': { w: 720, h: 1280, label: 'סטורי / ריל (9:16)' },
  '1:1': { w: 1080, h: 1080, label: 'ריבוע (1:1)' },
  '16:9': { w: 1280, h: 720, label: 'רוחב (16:9)' },
};

interface EditorState {
  clips: Clip[];
  crossfade: number;
  format: Format;
  subtitles: SubtitleCue[];
  subtitleStyle: SubtitleStyle;
  transcribeStatus: TranscribeStatus;
  transcribeProgress: number;
  selectedClipId: string | null;
  selectedCueId: string | null;
  playhead: number;
  seekRequest: number | null;

  addClips: (files: File[]) => Promise<void>;
  removeClip: (id: string) => void;
  reorderClips: (fromId: string, toId: string) => void;
  trimClip: (id: string, trimStart: number, trimEnd: number) => void;
  setCrossfade: (seconds: number) => void;
  setFormat: (format: Format) => void;
  selectClip: (id: string | null) => void;

  setSubtitles: (cues: SubtitleCue[]) => void;
  updateCue: (id: string, patch: Partial<SubtitleCue>) => void;
  addCue: (afterId?: string) => void;
  removeCue: (id: string) => void;
  selectCue: (id: string | null) => void;
  setSubtitleStyle: (patch: Partial<SubtitleStyle>) => void;

  setTranscribeStatus: (status: TranscribeStatus, progress?: number) => void;
  setPlayhead: (t: number) => void;
  requestSeek: (t: number) => void;
  consumeSeekRequest: () => void;
}

function loadMeta(file: File): Promise<{ duration: number; width: number; height: number; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    video.onloadedmetadata = () => {
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, url });
    };
    video.onerror = () => reject(new Error(`לא ניתן לקרוא את הקובץ ${file.name}`));
  });
}

export const useEditorStore = create<EditorState>((set, get) => ({
  clips: [],
  crossfade: 0.6,
  format: '9:16',
  subtitles: [],
  subtitleStyle: defaultSubtitleStyle,
  transcribeStatus: 'idle',
  transcribeProgress: 0,
  selectedClipId: null,
  selectedCueId: null,
  playhead: 0,
  seekRequest: null,

  addClips: async (files) => {
    const metas = await Promise.all(
      files.map(async (file) => {
        const meta = await loadMeta(file);
        const clip: Clip = {
          id: makeId(),
          file,
          url: meta.url,
          name: file.name,
          duration: meta.duration,
          trimStart: 0,
          trimEnd: meta.duration,
          width: meta.width,
          height: meta.height,
        };
        return clip;
      })
    );
    set((s) => ({ clips: [...s.clips, ...metas] }));
  },

  removeClip: (id) => {
    const clip = get().clips.find((c) => c.id === id);
    if (clip) URL.revokeObjectURL(clip.url);
    set((s) => ({ clips: s.clips.filter((c) => c.id !== id) }));
  },

  reorderClips: (fromId, toId) => {
    set((s) => {
      const clips = [...s.clips];
      const fromIdx = clips.findIndex((c) => c.id === fromId);
      const toIdx = clips.findIndex((c) => c.id === toId);
      if (fromIdx === -1 || toIdx === -1) return s;
      const [moved] = clips.splice(fromIdx, 1);
      clips.splice(toIdx, 0, moved);
      return { clips };
    });
  },

  trimClip: (id, trimStart, trimEnd) => {
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, trimStart, trimEnd } : c)),
    }));
  },

  setCrossfade: (seconds) => set({ crossfade: Math.max(0, seconds) }),
  setFormat: (format) => set({ format }),
  selectClip: (id) => set({ selectedClipId: id }),

  setSubtitles: (cues) => set({ subtitles: cues }),
  updateCue: (id, patch) =>
    set((s) => ({
      subtitles: s.subtitles.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  addCue: (afterId) =>
    set((s) => {
      const idx = afterId ? s.subtitles.findIndex((c) => c.id === afterId) : s.subtitles.length - 1;
      const prev = s.subtitles[idx];
      const start = prev ? prev.end : 0;
      const cue: SubtitleCue = { id: makeId(), text: 'כתובית חדשה', start, end: start + 2 };
      const subtitles = [...s.subtitles];
      subtitles.splice(idx + 1, 0, cue);
      return { subtitles, selectedCueId: cue.id };
    }),
  removeCue: (id) => set((s) => ({ subtitles: s.subtitles.filter((c) => c.id !== id) })),
  selectCue: (id) => set({ selectedCueId: id }),
  setSubtitleStyle: (patch) => set((s) => ({ subtitleStyle: { ...s.subtitleStyle, ...patch } })),

  setTranscribeStatus: (status, progress = 0) => set({ transcribeStatus: status, transcribeProgress: progress }),
  setPlayhead: (t) => set({ playhead: t }),
  requestSeek: (t) => set({ seekRequest: t }),
  consumeSeekRequest: () => set({ seekRequest: null }),
}));
