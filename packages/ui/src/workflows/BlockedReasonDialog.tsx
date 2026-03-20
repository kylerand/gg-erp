'use client';
import { useState } from 'react';

export interface BlockedReasonPayload {
  reasonCode: string;
  reasonText: string;
  ownerId?: string;
}

const REASON_CODES: { value: string; label: string }[] = [
  { value: 'WAITING_PARTS', label: 'Waiting for parts' },
  { value: 'WAITING_MANAGER', label: 'Waiting for manager approval' },
  { value: 'TOOLING_ISSUE', label: 'Tooling or equipment issue' },
  { value: 'CUSTOMER_HOLD', label: 'Customer hold / waiting for decision' },
  { value: 'SAFETY_CONCERN', label: 'Safety concern — must not proceed' },
  { value: 'OTHER', label: 'Other (describe below)' },
];

export function BlockedReasonDialog({
  open,
  onConfirm,
  onCancel,
  ownerOptions,
}: {
  open: boolean;
  onConfirm: (payload: BlockedReasonPayload) => void;
  onCancel: () => void;
  ownerOptions?: { id: string; name: string }[];
}) {
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [ownerId, setOwnerId] = useState('');

  if (!open) return null;

  const noteRequired = reasonCode === 'OTHER';
  const isValid = reasonCode !== '' && (!noteRequired || reasonText.trim().length > 0);

  function handleConfirm() {
    if (!isValid) return;
    onConfirm({
      reasonCode,
      reasonText,
      ownerId: ownerId !== '' ? ownerId : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div className="relative z-10 bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Mark as Blocked</h2>

        <div className="space-y-4">
          {/* Reason code */}
          <div>
            <label htmlFor="blocked-reason-code" className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <select
              id="blocked-reason-code"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">Select a reason…</option>
              {REASON_CODES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Note textarea */}
          <div>
            <label htmlFor="blocked-reason-text" className="block text-sm font-medium text-gray-700 mb-1">
              Note{noteRequired && <span className="text-red-500"> *</span>}
            </label>
            <textarea
              id="blocked-reason-text"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={noteRequired ? 'Describe the issue…' : 'Optional details…'}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
            <p className="text-xs text-gray-400 text-right mt-0.5">{reasonText.length}/500</p>
          </div>

          {/* Owner select (conditional) */}
          {ownerOptions && ownerOptions.length > 0 && (
            <div>
              <label htmlFor="blocked-owner" className="block text-sm font-medium text-gray-700 mb-1">
                Assign to
              </label>
              <select
                id="blocked-owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">Unassigned</option>
                {ownerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isValid}
            className="flex-1 min-h-[48px] rounded-md bg-red-600 text-white text-sm font-semibold px-4 py-3 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Mark Blocked
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[48px] rounded-md border border-gray-300 bg-white text-gray-700 text-sm font-semibold px-4 py-3 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
