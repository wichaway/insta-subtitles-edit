import { ClipTimeline } from './components/ClipTimeline';
import { PreviewPlayer } from './components/PreviewPlayer';
import { StylePanel } from './components/StylePanel';
import { SubtitleListEditor } from './components/SubtitleListEditor';
import { ExportPanel } from './components/ExportPanel';
import { useEditorStore } from './state/store';

function App() {
  const clipCount = useEditorStore((s) => s.clips.length);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">עורך וידאו + כתוביות</h1>
          <p className="text-xs text-muted">חיבור אוטומטי של קליפים, זיהוי דיבור וכתוביות — הכל בדפדפן, בלי שרת</p>
        </div>
      </header>

      <ClipTimeline />

      {clipCount > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <PreviewPlayer />
          <StylePanel />
        </div>
      )}

      {clipCount > 0 && (
        <>
          <SubtitleListEditor />
          <ExportPanel />
        </>
      )}
    </div>
  );
}

export default App;
