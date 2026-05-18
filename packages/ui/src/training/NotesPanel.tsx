'use client';

import { useEffect, useState } from 'react';

interface OjtNote {
  id: string;
  content: string;
  stepId?: string | null;
  createdAt: string;
}

interface NotesPanelProps {
  employeeId: string;
  moduleId: string;
  stepId?: string;
  initialNotes?: OjtNote[];
  onSave?: (content: string) => Promise<void>;
}

export function NotesPanel({ employeeId: _employeeId, moduleId: _moduleId, stepId: _stepId, initialNotes = [], onSave }: NotesPanelProps) {
  const existing = initialNotes[0]?.content ?? '';
  const [content, setContent] = useState(existing);
  const [lastSavedContent, setLastSavedContent] = useState(existing);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(existing);
    setLastSavedContent(existing);
    setSaved(false);
    setError(null);
  }, [existing]);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(content);
      setLastSavedContent(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Notes could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3 mt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
          📝 My Notes
        </h4>
        {saved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
      </div>
      <textarea
        value={content}
        onChange={e => { setContent(e.target.value); setSaved(false); setError(null); }}
        placeholder="Add notes for this step..."
        rows={4}
        className="w-full text-sm border border-gray-200 rounded-lg p-3 resize-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
      />
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      {onSave && (
        <button
          onClick={handleSave}
          disabled={saving || content === lastSavedContent || !content.trim()}
          className="px-3 py-1.5 text-xs font-semibold bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
      )}
    </div>
  );
}
