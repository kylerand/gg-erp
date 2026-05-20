'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getQuote,
  sendQuote,
  acceptQuote,
  convertQuoteToWorkOrder,
  rejectQuote,
  type Quote,
} from '@/lib/api-client';
import { erpRoute, erpRecordRoute } from '@/lib/erp-routes';
import { PageHeader, LoadingSkeleton } from '@gg-erp/ui';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-yellow-100 text-yellow-800',
  CONVERTED: 'bg-purple-100 text-purple-800',
};

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [convertedWorkOrder, setConvertedWorkOrder] = useState<{
    id: string;
    workOrderNumber: string;
    title: string;
    status: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getQuote(params.id, { allowMockFallback: false });
      setQuote(data);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSend = async () => {
    setActionLoading(true);
    try {
      const updated = await sendQuote(params.id);
      setQuote(updated);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      const updated = await acceptQuote(params.id);
      setQuote(updated);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('Reason for rejection (optional):');
    setActionLoading(true);
    try {
      const updated = await rejectQuote(params.id, reason ?? undefined);
      setQuote(updated);
    } finally {
      setActionLoading(false);
    }
  };

  const handleConvertToWorkOrder = async () => {
    setActionLoading(true);
    try {
      const result = await convertQuoteToWorkOrder(params.id);
      setQuote(result.quote);
      setConvertedWorkOrder(result.workOrder);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Loading..." />
        <LoadingSkeleton rows={6} cols={3} />
      </div>
    );
  }

  if (!quote) {
    return (
      <div>
        <PageHeader title="Quote Not Found" />
        <p className="text-sm text-gray-400 py-8 text-center">This quote could not be loaded.</p>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[quote.status] ?? 'bg-gray-100 text-gray-700';
  const lines = quote.lines ?? [];
  const convertedWorkOrderId = convertedWorkOrder?.id ?? quote.convertedWoId;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href={erpRoute('sales')} className="hover:text-yellow-600">
          Sales
        </Link>
        <span>/</span>
        <Link href={erpRoute('quote')} className="hover:text-yellow-600">
          Quotes
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{quote.quoteNumber}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{quote.quoteNumber}</h1>
          <div className="text-sm text-gray-500 mt-1">
            Created {new Date(quote.createdAt).toLocaleDateString()}
            {quote.validUntil &&
              ` · Valid until ${new Date(quote.validUntil).toLocaleDateString()}`}
          </div>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusColor}`}
        >
          {quote.status}
        </span>
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
        {[
          { label: 'Customer', value: quote.customerId },
          { label: 'Opportunity', value: quote.opportunityId ?? '—' },
          { label: 'Created By', value: quote.createdByUserId ?? '—' },
          { label: 'Updated', value: new Date(quote.updatedAt).toLocaleDateString() },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500">{item.label}</div>
            <div className="text-sm font-medium text-gray-900 mt-0.5 truncate">{item.value}</div>
          </div>
        ))}
      </div>

      {quote.notes && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="text-xs text-gray-500 mb-1">Notes</div>
          <p className="text-sm text-gray-700">{quote.notes}</p>
        </div>
      )}

      {convertedWorkOrderId && (
        <div className="bg-green-50 rounded-lg border border-green-200 p-4 mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-green-700">
                Work order created
              </div>
              <div className="text-sm text-green-900 mt-1">
                {convertedWorkOrder
                  ? `${convertedWorkOrder.workOrderNumber} is ready for shop execution.`
                  : 'This quote has been converted and is ready for shop execution.'}
              </div>
            </div>
            <Link
              href={erpRecordRoute('work-order', convertedWorkOrderId)}
              className="inline-flex items-center justify-center rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-800"
            >
              View Work Order
            </Link>
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Line Items</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center bg-white rounded-lg border border-gray-200">
            No line items.
          </p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Description</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Qty</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Unit Price</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Discount</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3 text-gray-900">{line.description}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {line.quantity}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      ${line.unitPrice.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">
                      {line.discountPercent > 0 ? `${line.discountPercent}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-gray-900">
                      ${line.lineTotal.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="flex justify-end">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-mono text-gray-900">${quote.subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tax ({quote.taxRate}%)</span>
              <span className="font-mono text-gray-900">${quote.taxAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-2">
              <span className="text-gray-900">Total</span>
              <span className="font-mono text-gray-900">${quote.total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {quote.status === 'DRAFT' && (
          <button
            onClick={handleSend}
            disabled={actionLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {actionLoading ? 'Sending...' : 'Send Quote'}
          </button>
        )}
        {quote.status === 'SENT' && (
          <>
            <button
              onClick={handleAccept}
              disabled={actionLoading}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {actionLoading ? 'Processing...' : 'Accept'}
            </button>
            <button
              onClick={handleReject}
              disabled={actionLoading}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Reject
            </button>
          </>
        )}
        {quote.status === 'ACCEPTED' && (
          <>
            <button
              onClick={handleConvertToWorkOrder}
              disabled={actionLoading || Boolean(convertedWorkOrderId)}
              className="bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {actionLoading ? 'Creating Work Order...' : 'Convert to Work Order'}
            </button>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
              Accepted
            </span>
          </>
        )}
        {quote.status === 'CONVERTED' && convertedWorkOrderId && (
          <Link
            href={erpRecordRoute('work-order', convertedWorkOrderId)}
            className="bg-purple-700 hover:bg-purple-800 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Open Work Order
          </Link>
        )}
      </div>
    </div>
  );
}
