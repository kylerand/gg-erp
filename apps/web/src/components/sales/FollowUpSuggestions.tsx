'use client';

import { useState, useCallback } from 'react';
import { sendAgentChat, createActivity } from '@/lib/api-client';

interface Props {
  opportunityId: string;
  opportunityTitle: string;
  stage: string;
  lastActivityDate?: string;
  customerName?: string;
}

interface FollowUp {
  type: string;
  subject: string;
  body: string;
  urgency: 'low' | 'medium' | 'high';
}

/**
 * AI-powered follow-up suggestions panel.
 * Analyzes opportunity stage, activity history, and timing to suggest follow-ups.
 */
export default function FollowUpSuggestions({
  opportunityId,
  opportunityTitle,
  stage,
  lastActivityDate,
  customerName,
}: Props) {
  const [suggestions, setSuggestions] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scheduling, setScheduling] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const daysSinceActivity = lastActivityDate
        ? Math.floor((Date.now() - new Date(lastActivityDate).getTime()) / 86400000)
        : null;

      const res = await sendAgentChat({
        message: `Suggest follow-up actions for this opportunity:
- Title: "${opportunityTitle}"
- Stage: ${stage}
- Customer: ${customerName ?? 'Unknown'}
${daysSinceActivity != null ? `- Days since last activity: ${daysSinceActivity}` : '- No previous activity logged'}

Give me exactly 3 follow-up suggestions. For each, provide:
1. Type (CALL, EMAIL, or MEETING)
2. Subject line
3. Brief description of what to discuss/include
4. Urgency level (low, medium, or high)

Format each as:
TYPE: [type]
SUBJECT: [subject]
BODY: [description]
URGENCY: [level]
---`,
        opportunityId,
      });

      // Parse structured response
      const blocks = res.message.split('---').filter((b) => b.trim());
      const parsed: FollowUp[] = blocks.slice(0, 3).map((block) => {
        const typeMatch = block.match(/TYPE:\s*(\w+)/i);
        const subjectMatch = block.match(/SUBJECT:\s*(.+)/i);
        const bodyMatch = block.match(/BODY:\s*([\s\S]*?)(?=URGENCY:|$)/i);
        const urgencyMatch = block.match(/URGENCY:\s*(\w+)/i);

        return {
          type: typeMatch?.[1]?.toUpperCase() ?? 'NOTE',
          subject: subjectMatch?.[1]?.trim() ?? 'Follow up',
          body: bodyMatch?.[1]?.trim() ?? '',
          urgency: (urgencyMatch?.[1]?.toLowerCase() as 'low' | 'medium' | 'high') ?? 'medium',
        };
      });

      // If parsing fails, create a single suggestion from the raw text
      if (parsed.length === 0) {
        parsed.push({
          type: 'NOTE',
          subject: 'Follow up on opportunity',
          body: res.message.substring(0, 300),
          urgency: 'medium',
        });
      }

      setSuggestions(parsed);
      setLoaded(true);
    } catch {
      setSuggestions([
        { type: 'NOTE', subject: 'Error', body: 'Could not generate suggestions.', urgency: 'low' },
      ]);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [opportunityId, opportunityTitle, stage, lastActivityDate, customerName, loading]);

  const scheduleFollowUp = useCallback(
    async (suggestion: FollowUp) => {
      setScheduling(suggestion.subject);
      try {
        await createActivity({
          opportunityId,
          activityType: suggestion.type,
          subject: suggestion.subject,
          body: suggestion.body,
        });
        // Remove from suggestions
        setSuggestions((prev) => prev.filter((s) => s.subject !== suggestion.subject));
      } finally {
        setScheduling(null);
      }
    },
    [opportunityId]
  );

  const URGENCY_COLORS = {
    low: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-red-100 text-red-700',
  };

  const TYPE_ICONS: Record<string, string> = {
    CALL: '📞',
    EMAIL: '✉️',
    MEETING: '🤝',
    NOTE: '📝',
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <span>⚡</span> Suggested Follow-ups
        </h2>
        {!loaded ? (
          <button
            onClick={loadSuggestions}
            disabled={loading}
            className="text-xs text-yellow-600 hover:text-yellow-700 font-medium disabled:opacity-50"
          >
            {loading ? 'Generating...' : '🤖 Get AI Suggestions'}
          </button>
        ) : (
          <button
            onClick={loadSuggestions}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        )}
      </div>

      {loading && !loaded && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" />
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            <span className="ml-1">Analyzing opportunity for follow-up ideas...</span>
          </div>
        </div>
      )}

      {!loaded && !loading && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-3 text-center">
          <p className="text-xs text-gray-600">
            AI will suggest personalized follow-ups based on the deal stage, customer history, and activity timeline.
          </p>
        </div>
      )}

      {loaded && suggestions.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-3">All suggestions have been scheduled! ✓</p>
      )}

      {loaded && suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((s, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 flex items-start gap-3">
              <span className="text-lg mt-0.5">{TYPE_ICONS[s.type] ?? '📝'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-900">{s.subject}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${URGENCY_COLORS[s.urgency]}`}>
                    {s.urgency}
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{s.body}</p>
              </div>
              <button
                onClick={() => scheduleFollowUp(s)}
                disabled={scheduling === s.subject}
                className="text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {scheduling === s.subject ? 'Logging...' : '+ Log'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
