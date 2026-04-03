'use client';

import { useState, useCallback } from 'react';
import { sendAgentChat } from '@/lib/api-client';

interface Props {
  customerId?: string;
  customerName?: string;
  opportunityId?: string;
  items?: Array<{ name: string; quantity: number; unitPrice: number }>;
}

interface PricingResult {
  summary: string;
  suggestions: Array<{
    item: string;
    currentPrice: string;
    suggestedPrice: string;
    reason: string;
  }>;
  totalImpact: string;
}

/**
 * AI-powered pricing intelligence panel.
 * Analyzes customer history, volume, and margins to suggest optimal pricing.
 */
export default function PricingIntelligence({
  customerId,
  customerName,
  opportunityId,
  items,
}: Props) {
  const [result, setResult] = useState<PricingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    try {
      const itemsList = items?.map((i) => `${i.name}: ${i.quantity}x @ $${i.unitPrice}`).join('\n') ?? 'No items specified';

      const res = await sendAgentChat({
        message: `Analyze pricing for this deal and suggest optimizations:
Customer: ${customerName ?? customerId ?? 'Unknown'}
${customerId ? `Customer ID: ${customerId}` : ''}
Items:
${itemsList}

Consider:
1. Customer's purchase history and loyalty
2. Volume discounts opportunities
3. Our margin targets (aim for 30-40% gross margin)
4. Competitive pricing in the golf cart market

Provide specific suggestions with dollar amounts.`,
        opportunityId,
      });

      // Parse response into structured result
      setResult({
        summary: res.message.substring(0, 500),
        suggestions: [],
        totalImpact: '',
      });
      setExpanded(true);
    } catch {
      setResult({
        summary: 'Unable to generate pricing analysis. Please try again.',
        suggestions: [],
        totalImpact: '',
      });
    } finally {
      setLoading(false);
    }
  }, [customerId, customerName, opportunityId, items]);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <button
        onClick={() => {
          if (!result) {
            analyze();
          } else {
            setExpanded(!expanded);
          }
        }}
        disabled={loading}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>💰</span>
          <span className="text-sm font-medium text-gray-800">Pricing Intelligence</span>
          {result && (
            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
              AI analyzed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {!loading && !result && (
            <span className="text-xs text-yellow-600 font-medium">Analyze</span>
          )}
          {result && (
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>

      {expanded && result && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="mt-3 text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
            {result.summary}
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            className="mt-2 text-xs text-yellow-600 hover:text-yellow-700 font-medium disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : '↻ Refresh Analysis'}
          </button>
        </div>
      )}
    </div>
  );
}
