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
import { useEditorStore } from '../state/store';
import type { Clip } from '../lib/types';
import { buildTimeline, clipDuration, clipLocalToGlobalTime } from '../lib/timeline';
import { UploadZone } from './UploadZone';

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function ClipCard({ clip, index }: { clip: Clip; index: number }) {
  const removeClip = useEditorStore((s) => s.removeClip);
  const trimClip = useEditorStore((s) => s.trimClip);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });

  // Applies the trim, then seeks the main preview to the frame being trimmed
  // to, so the user sees it live while dragging the slider. Reads the store
  // post-update so the global position reflects the trim just applied.
  function trimWithPreview(trimStart: number, trimEnd: number, previewLocalTime: number) {
    trimClip(clip.id, trimStart, trimEnd);
    const { clips, crossfade, requestSeek } = useEditorStore.getState();
    const globalTime = clipLocalToGlobalTime(buildTimeline(clips, crossfade), clip.id, previewLocalTime);
    if (globalTime != null) requestSeek(globalTime);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex w-56 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab select-none rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted active:cursor-grabbing"
          aria-label="גרור לסידור מחדש"
        >
          ⠿ #{index + 1}
        </button>
        <button
          onClick={() => removeClip(clip.id)}
          className="text-xs text-muted hover:text-danger"
          aria-label={`הסר את ${clip.name}`}
        >
          הסר ✕
        </button>
      </div>
      <p className="truncate text-xs text-muted" title={clip.name}>
        {clip.name}
      </p>
      <video src={clip.url} className="aspect-video w-full rounded bg-black object-cover" muted preload="metadata" />
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[11px] text-muted tabular-nums">
          <span>{fmt(clip.trimStart)}</span>
          <span>חיתוך</span>
          <span>{fmt(clip.trimEnd)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={clip.duration}
          step={0.1}
          value={clip.trimStart}
          onChange={(e) => {
            const trimStart = Math.min(Number(e.target.value), clip.trimEnd - 0.2);
            trimWithPreview(trimStart, clip.trimEnd, trimStart);
          }}
        />
        <input
          type="range"
          min={0}
          max={clip.duration}
          step={0.1}
          value={clip.trimEnd}
          onChange={(e) => {
            const trimEnd = Math.max(Number(e.target.value), clip.trimStart + 0.2);
            trimWithPreview(clip.trimStart, trimEnd, trimEnd);
          }}
        />
        <p className="text-center text-[11px] text-muted tabular-nums">משך: {fmt(clipDuration(clip))}</p>
      </div>
    </div>
  );
}

export function ClipTimeline() {
  const clips = useEditorStore((s) => s.clips);
  const reorderClips = useEditorStore((s) => s.reorderClips);
  const crossfade = useEditorStore((s) => s.crossfade);
  const setCrossfade = useEditorStore((s) => s.setCrossfade);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      reorderClips(String(active.id), String(over.id));
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
      <div className="flex gap-3 overflow-x-auto pb-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={clips.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {clips.map((clip, i) => (
              <ClipCard key={clip.id} clip={clip} index={i} />
            ))}
          </SortableContext>
        </DndContext>
        <div className="w-56 shrink-0">
          <UploadZone />
        </div>
      </div>
    </section>
  );
}
