'use client';

import { useState } from 'react';

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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
        onChange={e => { setContent(e.target.value); setSaved(false); }}
        placeholder="Add notes for this step..."
        rows={4}
        className="w-full text-sm border border-gray-200 rounded-lg p-3 resize-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
      />
      {onSave && (
        <button
          onClick={handleSave}
          disabled={saving || content === existing}
          className="px-3 py-1.5 text-xs font-semibold bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
      )}
    </div>
  );
}
