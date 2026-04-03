'use client';

import { useState, useCallback } from 'react';
import { sendAgentChat } from '@/lib/api-client';

interface Props {
  opportunityId?: string;
  customerName?: string;
  context?: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * AI-powered email drafting modal.
 * Uses the Sales Copilot to generate personalized follow-up emails.
 */
export default function EmailDraftModal({
  opportunityId,
  customerName,
  context,
  isOpen,
  onClose,
}: Props) {
  const [tone, setTone] = useState<'professional' | 'friendly' | 'urgent'>('professional');
  const [purpose, setPurpose] = useState('follow-up');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateDraft = useCallback(async () => {
    setLoading(true);
    setDraft(null);
    try {
      const res = await sendAgentChat({
        message: `Draft a ${tone} ${purpose} email for ${customerName ?? 'the customer'}.
${context ? `Context: ${context}` : ''}
${additionalNotes ? `Additional notes: ${additionalNotes}` : ''}

Please format your response as:
Subject: [email subject line]
---
[email body]

Keep it concise and professional. Include a clear call to action.`,
        opportunityId,
      });

      // Parse subject and body from response
      const text = res.message;
      const subjectMatch = text.match(/Subject:\s*(.+?)(?:\n|---)/i);
      const bodyMatch = text.split(/---\n?/);

      setDraft({
        subject: subjectMatch?.[1]?.trim() ?? 'Follow-up',
        body: (bodyMatch[1] ?? text).trim(),
      });
    } catch {
      setDraft({ subject: 'Error', body: 'Failed to generate email draft. Please try again.' });
    } finally {
      setLoading(false);
    }
  }, [tone, purpose, customerName, context, additionalNotes, opportunityId]);

  const copyToClipboard = useCallback(async () => {
    if (!draft) return;
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [draft]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">✉️</span>
            <h3 className="font-semibold text-gray-900">Draft Email</h3>
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">AI</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Options */}
        <div className="px-6 py-4 border-b border-gray-100 space-y-3">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 block mb-1">Purpose</label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="follow-up">Follow-up</option>
                <option value="quote">Quote/Proposal</option>
                <option value="introduction">Introduction</option>
                <option value="check-in">Check-in</option>
                <option value="thank-you">Thank You</option>
                <option value="scheduling">Schedule Meeting</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 block mb-1">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as 'professional' | 'friendly' | 'urgent')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Additional Notes</label>
            <input
              type="text"
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="e.g., They expressed interest in custom wheels..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={generateDraft}
            disabled={loading}
            className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors w-full"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                Drafting with AI...
              </span>
            ) : draft ? (
              '↻ Regenerate'
            ) : (
              '🤖 Generate Draft'
            )}
          </button>
        </div>

        {/* Draft output */}
        {draft && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Subject</label>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Body</label>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={12}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm leading-relaxed"
                />
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        {draft && (
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <button
              onClick={copyToClipboard}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
