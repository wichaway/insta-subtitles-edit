import { useState } from 'react';
import { useEditorStore } from '../state/store';
import { extractMergedAudio } from '../lib/extractAudio';
import { transcribe, type WhisperModel } from '../lib/whisper';
import { transcribeWithGroq, encodeWav } from '../lib/groqTranscribe';
import { WHISPER_SAMPLE_RATE } from '../lib/extractAudio';

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

const LANGUAGES: { code: string | null; label: string }[] = [
  { code: null, label: 'זיהוי אוטומטי' },
  { code: 'hebrew', label: 'עברית' },
  { code: 'english', label: 'אנגלית' },
];

/** transformers.js takes full language names; the Groq API takes ISO-639-1. */
const GROQ_LANGUAGE_CODES: Record<string, string> = {
  hebrew: 'he',
  english: 'en',
};

type Engine = 'browser' | 'groq';

export function SubtitleListEditor() {
  const clips = useEditorStore((s) => s.clips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const setSubtitles = useEditorStore((s) => s.setSubtitles);
  const updateCue = useEditorStore((s) => s.updateCue);
  const removeCue = useEditorStore((s) => s.removeCue);
  const addCue = useEditorStore((s) => s.addCue);
  const transcribeStatus = useEditorStore((s) => s.transcribeStatus);
  const transcribeProgress = useEditorStore((s) => s.transcribeProgress);
  const setTranscribeStatus = useEditorStore((s) => s.setTranscribeStatus);
  const playhead = useEditorStore((s) => s.playhead);
  const requestSeek = useEditorStore((s) => s.requestSeek);

  const [model, setModel] = useState<WhisperModel>('base');
  const [language, setLanguage] = useState<string | null>('hebrew');
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>(
    () => (localStorage.getItem('transcribe-engine') as Engine) || 'groq'
  );
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem('groq-api-key') ?? '');
  const [audioTestUrl, setAudioTestUrl] = useState<string | null>(null);
  const [audioTestBusy, setAudioTestBusy] = useState(false);

  function updateEngine(next: Engine) {
    setEngine(next);
    localStorage.setItem('transcribe-engine', next);
  }

  function updateGroqKey(next: string) {
    setGroqKey(next);
    localStorage.setItem('groq-api-key', next);
  }

  async function handleGenerate() {
    setError(null);
    if (engine === 'groq' && !groqKey.trim()) {
      setError('כדי להשתמש בתמלול הענן צריך להדביק מפתח API של Groq (חינם) בשדה למטה');
      return;
    }
    try {
      setTranscribeStatus('loading-model', 0);
      const audio = await extractMergedAudio(clips);
      let cues;
      if (engine === 'groq') {
        setTranscribeStatus('transcribing', 0.3);
        cues = await transcribeWithGroq({
          audio,
          apiKey: groqKey.trim(),
          language: language ? (GROQ_LANGUAGE_CODES[language] ?? null) : null,
        });
      } else {
        cues = await transcribe({
          audio,
          model,
          language,
          onProgress: (fraction, status) => setTranscribeStatus(status, fraction),
        });
      }
      setSubtitles(cues);
      setTranscribeStatus('done', 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בזיהוי הדיבור');
      setTranscribeStatus('error', 0);
    }
  }

  /** Extracts the same audio sent to transcription and offers it for listening. */
  async function handleAudioTest() {
    setError(null);
    setAudioTestBusy(true);
    try {
      const audio = await extractMergedAudio(clips);
      const wav = encodeWav(audio, WHISPER_SAMPLE_RATE);
      if (audioTestUrl) URL.revokeObjectURL(audioTestUrl);
      setAudioTestUrl(URL.createObjectURL(wav));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בחילוץ האודיו');
    } finally {
      setAudioTestBusy(false);
    }
  }

  const busy = transcribeStatus === 'loading-model' || transcribeStatus === 'transcribing';
  const sorted = [...subtitles].sort((a, b) => a.start - b.start);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">כתוביות</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={engine}
            onChange={(e) => updateEngine(e.target.value as Engine)}
            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-xs"
            disabled={busy}
            title="תמלול ענן (Groq) מדויק בהרבה לעברית; תמלול בדפדפן עובד בלי אינטרנט ובלי מפתח"
          >
            <option value="groq">☁️ תמלול ענן (מדויק, חינם)</option>
            <option value="browser">💻 תמלול בדפדפן (פרטי)</option>
          </select>
          <select
            value={language ?? ''}
            onChange={(e) => setLanguage(e.target.value || null)}
            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-xs"
            disabled={busy}
          >
            {LANGUAGES.map((l) => (
              <option key={l.label} value={l.code ?? ''}>
                {l.label}
              </option>
            ))}
          </select>
          {engine === 'browser' && (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as WhisperModel)}
              className="rounded border border-border bg-surface-2 px-2 py-1.5 text-xs"
              disabled={busy}
              title="מודל גדול יותר = דיוק גבוה יותר אך איטי יותר"
            >
              <option value="base">מודל מהיר</option>
              <option value="small">מודל מדויק (איטי יותר)</option>
            </select>
          )}
          <button
            onClick={handleGenerate}
            disabled={clips.length === 0 || busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          >
            {busy ? 'מזהה דיבור…' : '✨ צור כתוביות אוטומטית'}
          </button>
        </div>
      </div>

      {engine === 'groq' && (
        <div className="flex flex-col gap-1">
          <input
            type="password"
            dir="ltr"
            value={groqKey}
            onChange={(e) => updateGroqKey(e.target.value)}
            placeholder="gsk_... (מפתח API של Groq)"
            disabled={busy}
            autoComplete="off"
            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-xs"
          />
          <p className="text-[11px] text-muted">
            מפתח חינמי (בלי כרטיס אשראי): נרשמים ב-console.groq.com ← API Keys ← Create API Key. המפתח נשמר רק
            בדפדפן שלכם, והאודיו נשלח ישירות ל-Groq לצורך התמלול.
          </p>
        </div>
      )}

      {busy && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(4, transcribeProgress * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted">
            {transcribeStatus === 'loading-model'
              ? engine === 'groq'
                ? 'מחלץ אודיו מהסרטון…'
                : 'טוען מודל זיהוי דיבור (פעם ראשונה עלולה לקחת זמן)…'
              : 'מתמלל…'}
          </p>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-[11px] text-muted">
        התזמון האוטומטי מבוסס זיהוי דיבור וייתכנו סטיות קטנות, בעיקר בין קליפים מחוברים. אפשר לתקן ידנית כל כתובית
        ברשימה למטה — פשוט למלא את השנייה המדויקת שבה היא צריכה להופיע ולהיעלם.
      </p>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{sorted.length} כתוביות</span>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAudioTest}
            disabled={clips.length === 0 || busy || audioTestBusy}
            className="text-xs text-muted hover:text-text hover:underline disabled:opacity-40"
            title="האזנה לאודיו בדיוק כפי שהוא נשלח לזיהוי הדיבור"
          >
            {audioTestBusy ? 'מחלץ אודיו…' : '🎧 בדיקת אודיו'}
          </button>
          <button onClick={() => addCue()} className="text-xs text-accent hover:underline">
            + הוספת כתובית ידנית
          </button>
        </div>
      </div>

      {audioTestUrl && (
        <div className="flex flex-col gap-1">
          <audio controls src={audioTestUrl} className="w-full" />
          <p className="text-[11px] text-muted">
            כך נשמע האודיו שנשלח לתמלול. אם הוא מקוטע/מעוות — הבעיה בחילוץ; אם הוא תקין אבל הדיבור מוסתר על ידי
            מוזיקה — זה מה שמקשה על הזיהוי.
          </p>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-surface-2 text-muted">
            <tr>
              <th className="px-2 py-2 text-right font-medium">טקסט</th>
              <th className="w-24 px-2 py-2 font-medium">מ־(שנ&apos;)</th>
              <th className="w-24 px-2 py-2 font-medium">עד־(שנ&apos;)</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((cue) => {
              const active = playhead >= cue.start && playhead < cue.end;
              return (
                <tr
                  key={cue.id}
                  onClick={() => requestSeek(cue.start)}
                  className={`cursor-pointer border-t border-border ${active ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
                >
                  <td className="px-2 py-1.5">
                    <input
                      value={cue.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateCue(cue.id, { text: e.target.value })}
                      className="w-full min-w-40 rounded border border-transparent bg-transparent px-1.5 py-1 text-text focus:border-border focus:bg-surface-2"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step={0.1}
                      value={Number(cue.start.toFixed(2))}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateCue(cue.id, { start: Number(e.target.value) })}
                      className="w-full rounded border border-border bg-surface-2 px-1.5 py-1 text-center tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step={0.1}
                      value={Number(cue.end.toFixed(2))}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateCue(cue.id, { end: Number(e.target.value) })}
                      className="w-full rounded border border-border bg-surface-2 px-1.5 py-1 text-center tabular-nums"
                    />
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCue(cue.id);
                      }}
                      className="text-muted hover:text-danger"
                      aria-label="מחק כתובית"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-muted">
                  אין עדיין כתוביות — צרו אוטומטית או הוסיפו ידנית
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted tabular-nums">מיקום נוכחי: {fmt(playhead)}</p>
    </section>
  );
}
