import { useEditorStore, defaultSubtitleStyle } from '../state/store';
import type { SubtitlePosition } from '../lib/types';

const FONTS = ['Rubik', 'Arial', 'Georgia', 'Courier New', 'Impact'];
const POSITIONS: { key: SubtitlePosition; label: string }[] = [
  { key: 'top', label: 'למעלה' },
  { key: 'center', label: 'מרכז' },
  { key: 'bottom', label: 'למטה' },
  { key: 'custom', label: 'מותאם אישית' },
];

export function StylePanel() {
  const style = useEditorStore((s) => s.subtitleStyle);
  const setStyle = useEditorStore((s) => s.setSubtitleStyle);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">סגנון כתוביות</h2>
        <button
          onClick={() => setStyle(defaultSubtitleStyle)}
          className="text-xs text-muted hover:text-text"
        >
          איפוס
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        גופן
        <select
          value={style.fontFamily}
          onChange={(e) => setStyle({ fontFamily: e.target.value })}
          className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text"
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted">
        גודל טקסט ({style.fontSize.toFixed(1)}%)
        <input
          type="range"
          min={2}
          max={12}
          step={0.1}
          value={style.fontSize}
          onChange={(e) => setStyle({ fontSize: Number(e.target.value) })}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          צבע טקסט
          <input
            type="color"
            value={style.color}
            onChange={(e) => setStyle({ color: e.target.value })}
            className="h-9 w-full rounded border border-border bg-surface-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          צבע רקע
          <input
            type="color"
            value={style.backgroundColor}
            onChange={(e) => setStyle({ backgroundColor: e.target.value })}
            className="h-9 w-full rounded border border-border bg-surface-2"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        שקיפות רקע ({Math.round(style.backgroundOpacity * 100)}%)
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={style.backgroundOpacity}
          onChange={(e) => setStyle({ backgroundOpacity: Number(e.target.value) })}
        />
      </label>

      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={style.bold} onChange={(e) => setStyle({ bold: e.target.checked })} />
          מודגש
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={style.outline} onChange={(e) => setStyle({ outline: e.target.checked })} />
          מתאר שחור
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted">מיקום</span>
        <div className="grid grid-cols-4 gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p.key}
              onClick={() => setStyle({ position: p.key })}
              className={`rounded px-1 py-1.5 text-[11px] ${
                style.position === p.key ? 'bg-accent text-black font-medium' : 'bg-surface-2 text-muted hover:text-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {style.position === 'custom' && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            אופקי ({Math.round(style.x * 100)}%)
            <input type="range" min={0} max={1} step={0.01} value={style.x} onChange={(e) => setStyle({ x: Number(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            אנכי ({Math.round(style.y * 100)}%)
            <input type="range" min={0} max={1} step={0.01} value={style.y} onChange={(e) => setStyle({ y: Number(e.target.value) })} />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted">
        רוחב מקסימלי ({Math.round(style.maxWidth * 100)}%)
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.02}
          value={style.maxWidth}
          onChange={(e) => setStyle({ maxWidth: Number(e.target.value) })}
        />
      </label>
    </section>
  );
}
