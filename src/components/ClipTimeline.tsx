import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../state/store';
import type { TimelineSegment } from '../lib/types';
import { buildTimeline, clipDuration, clipLocalToGlobalTime } from '../lib/timeline';
import { UploadZone } from './UploadZone';

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

// The page is RTL, so the strip flows right-to-left (first clip on the
// right), matching the direction of the seek slider in the preview player.
const isRTL = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

function Segment({
  seg,
  widthPct,
  isLast,
  selected,
  onSegmentClick,
}: {
  seg: TimelineSegment;
  widthPct: number;
  isLast: boolean;
  selected: boolean;
  onSegmentClick: (seg: TimelineSegment, clientX: number, el: HTMLElement) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seg.clip.id,
  });
  const videoRef = useRef<HTMLVideoElement>(null);

  // Show the frame at the clip's in-point (not frame 0) as the segment
  // thumbnail, so the two halves of a split clip look different.
  const { trimStart } = seg.clip;
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.readyState >= 1) v.currentTime = trimStart;
  }, [trimStart]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        width: `${widthPct}%`,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      onClick={(e) => onSegmentClick(seg, e.clientX, e.currentTarget)}
      className={`relative h-full min-w-0 cursor-pointer touch-none select-none overflow-hidden bg-surface-2 ${
        isLast ? '' : 'border-e-2 border-bg'
      }`}
      title={seg.clip.name}
      aria-label={`קטע ${seg.clipIndex + 1}: ${seg.clip.name}`}
    >
      <video
        ref={videoRef}
        src={seg.clip.url}
        muted
        preload="metadata"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = seg.clip.trimStart;
        }}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
      />
      <span className="absolute bottom-0.5 start-1 rounded bg-black/60 px-1 text-[10px] tabular-nums text-text">
        #{seg.clipIndex + 1} · {fmt(clipDuration(seg.clip))}
      </span>
      {selected && <div className="pointer-events-none absolute inset-0 ring-2 ring-accent ring-inset" />}
    </div>
  );
}

export function ClipTimeline() {
  const clips = useEditorStore((s) => s.clips);
  const crossfade = useEditorStore((s) => s.crossfade);
  const setCrossfade = useEditorStore((s) => s.setCrossfade);
  const reorderClips = useEditorStore((s) => s.reorderClips);
  const removeClip = useEditorStore((s) => s.removeClip);
  const trimClip = useEditorStore((s) => s.trimClip);
  const splitClipAtGlobalTime = useEditorStore((s) => s.splitClipAtGlobalTime);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const playhead = useEditorStore((s) => s.playhead);
  const requestSeek = useEditorStore((s) => s.requestSeek);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // A completed drag still fires a click on the segment under the pointer;
  // this flag swallows that click so a reorder doesn't also seek/select.
  const justDragged = useRef(false);

  const segments = buildTimeline(clips, crossfade);
  // Widths are proportional to each clip's trimmed duration. Crossfade
  // overlap is not subtracted visually — the dividers still mark every cut.
  const durSum = segments.reduce((sum, sg) => sum + clipDuration(sg.clip), 0);
  let acc = 0;
  const fracs = segments.map((sg) => {
    const width = durSum > 0 ? clipDuration(sg.clip) / durSum : 1 / segments.length;
    const frac = { start: acc, width };
    acc += width;
    return frac;
  });

  const selectedSeg = segments.find((sg) => sg.clip.id === selectedClipId) ?? null;
  const selected = selectedSeg?.clip ?? null;
  // Mirrors the MIN_SPLIT_PIECE guard in splitClipAtGlobalTime, so the button
  // disables exactly when a split at the playhead would be a no-op.
  const canCutHere =
    selectedSeg != null &&
    playhead > selectedSeg.globalStart + 0.05 &&
    playhead < selectedSeg.globalEnd - 0.05;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      reorderClips(String(active.id), String(over.id));
    }
    justDragged.current = true;
    // The stray click (if any) fires synchronously after pointerup, before
    // timers run, so this reset never swallows a genuine later click.
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  }

  function handleSegmentClick(seg: TimelineSegment, clientX: number, el: HTMLElement) {
    if (justDragged.current) return;
    const rect = el.getBoundingClientRect();
    const raw = isRTL ? (rect.right - clientX) / rect.width : (clientX - rect.left) / rect.width;
    const frac = Math.min(Math.max(raw, 0), 1);
    const t = seg.globalStart + frac * (seg.globalEnd - seg.globalStart);
    selectClip(seg.clip.id);
    requestSeek(t);
    setPlayhead(t);
  }

  // Maps the global playhead time to a 0-1 position along the strip. During
  // a crossfade overlap two segments contain the playhead; the later one wins
  // (matching activeFramesAt, which draws the incoming clip on top).
  function playheadFrac(): number {
    for (let i = segments.length - 1; i >= 0; i--) {
      const sg = segments[i];
      if (playhead >= sg.globalStart) {
        const span = sg.globalEnd - sg.globalStart;
        const inner = span > 0 ? Math.min((playhead - sg.globalStart) / span, 1) : 0;
        return fracs[i].start + inner * fracs[i].width;
      }
    }
    return 0;
  }

  // Applies the trim, then seeks the main preview to the frame being trimmed
  // to, so the user sees it live while dragging the slider. Reads the store
  // post-update so the global position reflects the trim just applied.
  function trimWithPreview(clipId: string, trimStart: number, trimEnd: number, previewLocalTime: number) {
    trimClip(clipId, trimStart, trimEnd);
    const state = useEditorStore.getState();
    const globalTime = clipLocalToGlobalTime(buildTimeline(state.clips, state.crossfade), clipId, previewLocalTime);
    if (globalTime != null) {
      state.requestSeek(globalTime);
      state.setPlayhead(globalTime);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">קליפים ({clips.length})</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          מעבר חלק בין קליפים
          <input
            type="number"
            min={0}
            max={3}
            step={0.1}
            value={crossfade}
            onChange={(e) => setCrossfade(Number(e.target.value))}
            className="w-16 rounded border border-border bg-surface-2 px-2 py-1 text-text tabular-nums"
          />
          <span>שנ&apos;</span>
        </label>
      </div>

      {clips.length > 0 && (
        <div className="relative flex h-16 w-full overflow-hidden rounded-lg border border-border bg-surface">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={clips.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              {segments.map((sg, i) => (
                <Segment
                  key={sg.clip.id}
                  seg={sg}
                  widthPct={fracs[i].width * 100}
                  isLast={i === segments.length - 1}
                  selected={sg.clip.id === selectedClipId}
                  onSegmentClick={handleSegmentClick}
                />
              ))}
            </SortableContext>
          </DndContext>
          <div
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-accent"
            style={{ insetInlineStart: `calc(${playheadFrac() * 100}% - 1px)` }}
          />
        </div>
      )}

      {selected && selectedSeg && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-xs text-muted" title={selected.name}>
              קטע #{selectedSeg.clipIndex + 1} · {selected.name} · {fmt(clipDuration(selected))}
            </span>
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <button
                onClick={() => splitClipAtGlobalTime(playhead)}
                disabled={!canCutHere}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text disabled:cursor-not-allowed disabled:opacity-40"
                title="פצל את הקטע בנקודת הנגן"
              >
                ✂ חתוך כאן
              </button>
              <button
                onClick={() => removeClip(selected.id)}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-danger hover:border-danger"
                aria-label={`הסר את ${selected.name}`}
              >
                ✕ מחק קטע
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-muted tabular-nums">
              <span>{fmt(selected.trimStart)}</span>
              <span>חיתוך</span>
              <span>{fmt(selected.trimEnd)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={selected.duration}
              step={0.1}
              value={selected.trimStart}
              onChange={(e) => {
                const trimStart = Math.min(Number(e.target.value), selected.trimEnd - 0.2);
                trimWithPreview(selected.id, trimStart, selected.trimEnd, trimStart);
              }}
            />
            <input
              type="range"
              min={0}
              max={selected.duration}
              step={0.1}
              value={selected.trimEnd}
              onChange={(e) => {
                const trimEnd = Math.max(Number(e.target.value), selected.trimStart + 0.2);
                trimWithPreview(selected.id, selected.trimStart, trimEnd, trimEnd);
              }}
            />
          </div>
        </div>
      )}

      <UploadZone />
    </section>
  );
}
