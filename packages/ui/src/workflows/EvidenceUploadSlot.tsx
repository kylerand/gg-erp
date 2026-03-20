'use client';
import { useRef } from 'react';

export interface EvidenceFile {
  id: string;
  fileName: string;
  uploadState: 'pending' | 'uploading' | 'done' | 'error';
  progress?: number;
  errorMessage?: string;
}

const STATE_CHIP: Record<EvidenceFile['uploadState'], { label: string; classes: string }> = {
  pending: { label: 'Pending', classes: 'bg-gray-100 text-gray-600' },
  uploading: { label: 'Uploading…', classes: 'bg-blue-100 text-blue-700' },
  done: { label: '✓ Done', classes: 'bg-green-100 text-green-700' },
  error: { label: '✕ Error', classes: 'bg-red-100 text-red-700' },
};

export function EvidenceUploadSlot({
  label,
  required,
  files,
  onFilesSelected,
  onRemoveFile,
  disabled,
}: {
  label?: string;
  required?: boolean;
  files: EvidenceFile[];
  onFilesSelected: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) onFilesSelected(dropped);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) onFilesSelected(selected);
    // reset so same file can be re-selected
    e.target.value = '';
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors
          ${disabled
            ? 'border-gray-200 bg-gray-50 cursor-not-allowed text-gray-400'
            : 'border-gray-300 bg-white cursor-pointer hover:border-blue-400 hover:bg-blue-50 text-gray-600'
          }`}
      >
        <span className="text-base">
          📎 {label ?? 'Attach evidence'}
          {required && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
              Required
            </span>
          )}
        </span>
        <span className="text-xs text-gray-400">Click or drag files here</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          disabled={disabled}
          onChange={handleChange}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file) => {
            const chip = STATE_CHIP[file.uploadState];
            return (
              <li
                key={file.id}
                className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-800 truncate max-w-[200px]">{file.fileName}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${chip.classes}`}>
                      {chip.label}
                    </span>
                  </div>

                  {file.uploadState === 'uploading' && file.progress !== undefined && (
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min(100, file.progress)}%` }}
                      />
                    </div>
                  )}

                  {file.uploadState === 'error' && file.errorMessage && (
                    <p className="mt-0.5 text-xs text-red-600">{file.errorMessage}</p>
                  )}
                </div>

                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onRemoveFile(file.id)}
                    aria-label={`Remove ${file.fileName}`}
                    className="flex-shrink-0 min-w-[48px] min-h-[48px] flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
