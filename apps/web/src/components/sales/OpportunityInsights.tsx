'use client';

import { useState, useCallback } from 'react';
import { sendAgentChat } from '@/lib/api-client';

interface Props {
  opportunityId: string;
  title: string;
  estimatedValue: number | null;
  stage: string;
  probability: number;
  customerId: string;
}

interface Insight {
  type: 'lead_score' | 'next_steps' | 'pricing' | 'risk';
  label: string;
  content: string;
}

/**
 * AI-powered insights panel for a specific opportunity.
 * Shows lead score, suggested next steps, pricing tips, and risk alerts.
 */
export default function OpportunityInsights({
  opportunityId,
  title,
  estimatedValue,
  stage,
  probability,
  customerId,
}: Props) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadInsights = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await sendAgentChat({
        message: `Analyze this opportunity and provide a brief assessment:
- Opportunity: "${title}"
- Stage: ${stage}
- Probability: ${probability}%
- Estimated Value: $${(estimatedValue ?? 0).toLocaleString()}
- Customer ID: ${customerId}

Please provide:
1. A lead score (1-100) with a one-line explanation
2. Top 2-3 recommended next steps
3. Any pricing suggestions based on the deal size
4. Any risks or concerns

Keep each section brief (1-3 sentences).`,
        opportunityId,
      });

      // Parse the response into insight sections
      const content = res.message;
      const parsed: Insight[] = [];

      // Extract lead score section
      const scoreMatch = content.match(/(?:lead\s*score|score)[:\s]*(\d+)/i);
      if (scoreMatch) {
        const scoreIdx = content.indexOf(scoreMatch[0]);
        const sectionEnd = content.indexOf('\n\n', scoreIdx);
        parsed.push({
          type: 'lead_score',
          label: `Lead Score: ${scoreMatch[1]}/100`,
          content: content.substring(scoreIdx, sectionEnd > scoreIdx ? sectionEnd : scoreIdx + 200).trim(),
        });
      }

      // If we couldn't parse structured sections, just use the full response
      if (parsed.length === 0) {
        parsed.push({
          type: 'next_steps',
          label: 'AI Analysis',
          content: content.substring(0, 1000),
        });
      } else {
        // Add next steps
        const stepsMatch = content.match(/(?:next steps|recommended|suggestions?)[:\s]*([\s\S]*?)(?=\n\n(?:pricing|risk|concern)|$)/i);
        if (stepsMatch) {
          parsed.push({
            type: 'next_steps',
            label: 'Next Steps',
            content: stepsMatch[1].trim().substring(0, 400),
          });
        }

        // Add pricing if available
        const pricingMatch = content.match(/(?:pricing|price)[:\s]*([\s\S]*?)(?=\n\n(?:risk|concern)|$)/i);
        if (pricingMatch) {
          parsed.push({
            type: 'pricing',
            label: 'Pricing Insight',
            content: pricingMatch[1].trim().substring(0, 300),
          });
        }

        // Add risk if available
        const riskMatch = content.match(/(?:risk|concern)[:\s]*([\s\S]*?)$/i);
        if (riskMatch) {
          parsed.push({
            type: 'risk',
            label: 'Risk Assessment',
            content: riskMatch[1].trim().substring(0, 300),
          });
        }
      }

      setInsights(parsed);
      setLoaded(true);
    } catch {
      setInsights([
        { type: 'risk', label: 'Error', content: 'Could not load AI insights. Try again later.' },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, opportunityId, title, stage, probability, estimatedValue, customerId]);

  const ICON_MAP: Record<string, string> = {
    lead_score: '🎯',
    next_steps: '📋',
    pricing: '💰',
    risk: '⚠️',
  };

  const COLOR_MAP: Record<string, string> = {
    lead_score: 'border-blue-200 bg-blue-50',
    next_steps: 'border-green-200 bg-green-50',
    pricing: 'border-yellow-200 bg-yellow-50',
    risk: 'border-red-200 bg-red-50',
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <span>🤖</span> AI Insights
        </h2>
        {!loaded && (
          <button
            onClick={loadInsights}
            disabled={loading}
            className="text-xs text-yellow-600 hover:text-yellow-700 font-medium disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : 'Generate Insights'}
          </button>
        )}
        {loaded && (
          <button
            onClick={loadInsights}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        )}
      </div>

      {loading && !loaded && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            <span className="ml-2">Analyzing opportunity with AI...</span>
          </div>
        </div>
      )}

      {!loaded && !loading && (
        <div className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg border border-yellow-200 p-4 text-center">
          <p className="text-xs text-gray-600">
            Click &quot;Generate Insights&quot; to get AI-powered lead scoring, next steps, and pricing suggestions.
          </p>
        </div>
      )}

      {loaded && insights.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {insights.map((insight, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 ${COLOR_MAP[insight.type] ?? 'border-gray-200 bg-white'}`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span>{ICON_MAP[insight.type] ?? '💡'}</span>
                <span className="text-xs font-semibold text-gray-700">{insight.label}</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                {insight.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
