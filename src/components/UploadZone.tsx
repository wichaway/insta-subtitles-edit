import { useCallback, useRef, useState } from 'react';
import { useEditorStore } from '../state/store';

export function UploadZone() {
  const addClips = useEditorStore((s) => s.addClips);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const videos = Array.from(files).filter((f) => f.type.startsWith('video/'));
      if (videos.length === 0) return;
      setLoading(true);
      try {
        await addClips(videos);
      } finally {
        setLoading(false);
      }
    },
    [addClips]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
        dragOver ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-muted'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <span className="text-2xl">🎬</span>
      <p className="text-sm font-medium">
        {loading ? 'טוען סרטונים…' : 'גררו לכאן סרטונים, או לחצו לבחירה'}
      </p>
      <p className="text-xs text-muted">אפשר לבחור כמה קבצים יחד — הם יחוברו אוטומטית לפי הסדר</p>
    </div>
  );
}
