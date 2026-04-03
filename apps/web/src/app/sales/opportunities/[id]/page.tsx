'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getOpportunity,
  createActivity,
  type SalesOpportunity,
  type Quote,
  type SalesActivity,
} from '@/lib/api-client';
import { PageHeader, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import OpportunityInsights from '@/components/sales/OpportunityInsights';
import FollowUpSuggestions from '@/components/sales/FollowUpSuggestions';
import EmailDraftModal from '@/components/sales/EmailDraftModal';

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: 'bg-blue-100 text-blue-800',
  QUALIFIED: 'bg-yellow-100 text-yellow-800',
  PROPOSAL: 'bg-orange-100 text-orange-800',
  NEGOTIATION: 'bg-purple-100 text-purple-800',
  CLOSED_WON: 'bg-green-100 text-green-800',
  CLOSED_LOST: 'bg-red-100 text-red-800',
};

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const [opportunity, setOpportunity] = useState<(SalesOpportunity & { quotes: Quote[]; activities: SalesActivity[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [activityType, setActivityType] = useState('NOTE');
  const [activitySubject, setActivitySubject] = useState('');
  const [activityBody, setActivityBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showEmailDraft, setShowEmailDraft] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOpportunity(params.id);
      setOpportunity(data);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLogActivity = async () => {
    if (!activitySubject.trim()) return;
    setSubmitting(true);
    try {
      await createActivity({
        opportunityId: params.id,
        activityType,
        subject: activitySubject,
        body: activityBody || undefined,
      });
      setActivitySubject('');
      setActivityBody('');
      setShowActivityForm(false);
      void load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Loading..." />
        <LoadingSkeleton rows={6} cols={2} />
      </div>
    );
  }

  if (!opportunity) {
    return (
      <div>
        <PageHeader title="Opportunity Not Found" />
        <p className="text-sm text-gray-400 py-8 text-center">This opportunity could not be loaded.</p>
      </div>
    );
  }

  const stageColor = STAGE_COLORS[opportunity.stage] ?? 'bg-gray-100 text-gray-800';

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/sales" className="hover:text-yellow-600">Sales</Link>
        <span>/</span>
        <Link href="/sales/pipeline" className="hover:text-yellow-600">Pipeline</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{opportunity.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{opportunity.title}</h1>
          {opportunity.description && (
            <p className="text-sm text-gray-600 mt-1">{opportunity.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${stageColor}`}>
            {opportunity.stage.replace(/_/g, ' ')}
          </span>
          <span className="text-sm text-gray-500">{opportunity.probability}%</span>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mb-8">
        {[
          { label: 'Customer', value: opportunity.customerId },
          { label: 'Source', value: opportunity.source },
          { label: 'Estimated Value', value: opportunity.estimatedValue != null ? `$${opportunity.estimatedValue.toLocaleString()}` : '—' },
          { label: 'Expected Close', value: opportunity.expectedCloseDate ? new Date(opportunity.expectedCloseDate).toLocaleDateString() : '—' },
          { label: 'Assigned To', value: opportunity.assignedToUserId ?? 'Unassigned' },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500">{item.label}</div>
            <div className="text-sm font-medium text-gray-900 mt-0.5 truncate">{item.value}</div>
          </div>
        ))}
      </div>

      {/* AI Insights — Phase 4 */}
      <OpportunityInsights
        opportunityId={params.id}
        title={opportunity.title}
        estimatedValue={opportunity.estimatedValue}
        stage={opportunity.stage}
        probability={opportunity.probability}
        customerId={opportunity.customerId}
      />

      {/* Follow-up Suggestions — Phase 4 */}
      <FollowUpSuggestions
        opportunityId={params.id}
        opportunityTitle={opportunity.title}
        stage={opportunity.stage}
        lastActivityDate={opportunity.activities[0]?.createdAt}
        customerName={opportunity.customerId}
      />

      {/* Quotes */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Linked Quotes</h2>
        {opportunity.quotes.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center bg-white rounded-lg border border-gray-200">
            No quotes linked to this opportunity.
          </p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Quote #</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Total</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {opportunity.quotes.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/sales/quotes/${q.id}`} className="font-mono font-medium text-gray-900 hover:text-yellow-600">
                        {q.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                    <td className="px-4 py-3 font-mono text-gray-700">${q.total.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(q.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activities */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Activity Timeline</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmailDraft(true)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              ✉️ Draft Email
            </button>
            <button
              onClick={() => setShowActivityForm(!showActivityForm)}
              className="text-sm text-yellow-600 hover:text-yellow-700 font-medium"
            >
              {showActivityForm ? 'Cancel' : '+ Log Activity'}
            </button>
          </div>
        </div>

        {showActivityForm && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3">
            <div className="flex gap-3">
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="NOTE">Note</option>
                <option value="CALL">Call</option>
                <option value="EMAIL">Email</option>
                <option value="MEETING">Meeting</option>
              </select>
              <input
                type="text"
                placeholder="Subject"
                value={activitySubject}
                onChange={(e) => setActivitySubject(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <textarea
              placeholder="Notes (optional)"
              value={activityBody}
              onChange={(e) => setActivityBody(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              rows={2}
            />
            <button
              onClick={handleLogActivity}
              disabled={submitting || !activitySubject.trim()}
              className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {submitting ? 'Saving...' : 'Save Activity'}
            </button>
          </div>
        )}

        {opportunity.activities.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center bg-white rounded-lg border border-gray-200">
            No activity recorded yet.
          </p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {opportunity.activities.map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                <span className="text-lg mt-0.5">
                  {a.activityType === 'CALL'
                    ? '📞'
                    : a.activityType === 'EMAIL'
                      ? '✉️'
                      : a.activityType === 'MEETING'
                        ? '🤝'
                        : '📝'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{a.subject}</div>
                  {a.body && <div className="text-xs text-gray-600 mt-0.5">{a.body}</div>}
                  <div className="text-xs text-gray-400 mt-1">
                    {a.activityType} · {new Date(a.createdAt).toLocaleDateString()}
                    {a.completedAt && ' · Completed'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Email Draft Modal — Phase 4 */}
      <EmailDraftModal
        isOpen={showEmailDraft}
        onClose={() => setShowEmailDraft(false)}
        opportunityId={params.id}
        customerName={opportunity.customerId}
        context={`Opportunity: ${opportunity.title}, Stage: ${opportunity.stage}, Value: $${(opportunity.estimatedValue ?? 0).toLocaleString()}`}
      />
    </div>
  );
}
