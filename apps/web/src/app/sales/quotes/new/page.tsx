'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createQuote } from '@/lib/api-client';
import { PageHeader } from '@gg-erp/ui';

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

const emptyLine = (): LineItem => ({ description: '', quantity: 1, unitPrice: 0, discountPercent: 0 });

export default function NewQuotePage() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLine = (index: number, field: keyof LineItem, value: string | number) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const lineTotal = (line: LineItem) => {
    const base = line.quantity * line.unitPrice;
    return base - base * (line.discountPercent / 100);
  };

  const quoteTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  const handleSubmit = async () => {
    if (!customerId.trim()) {
      setError('Customer is required.');
      return;
    }
    if (lines.length === 0 || lines.every((l) => !l.description.trim())) {
      setError('At least one line item with a description is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const quote = await createQuote({
        customerId: customerId.trim(),
        opportunityId: opportunityId.trim() || undefined,
        notes: notes.trim() || undefined,
        validUntil: validUntil || undefined,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent || undefined,
          })),
      });
      router.push(`/sales/quotes/${quote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quote.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/sales" className="hover:text-yellow-600">Sales</Link>
        <span>/</span>
        <Link href="/sales/quotes" className="hover:text-yellow-600">Quotes</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">New Quote</span>
      </div>

      <PageHeader title="New Quote" description="Build a new quote for a customer" />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Form fields */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer ID *</label>
            <input
              type="text"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="e.g. c-1"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Opportunity ID</label>
            <input
              type="text"
              value={opportunityId}
              onChange={(e) => setOpportunityId(e.target.value)}
              placeholder="Optional"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
          <button
            onClick={addLine}
            className="text-sm text-yellow-600 hover:text-yellow-700 font-medium"
          >
            + Add Line
          </button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Description</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 w-24">Qty</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 w-32">Unit Price</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 w-28">Discount %</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 w-32">Total</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      placeholder="Item description"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={line.unitPrice}
                      onChange={(e) => updateLine(idx, 'unitPrice', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={line.discountPercent}
                      onChange={(e) => updateLine(idx, 'discountPercent', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-900">
                    ${lineTotal(line).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {lines.length > 1 && (
                      <button
                        onClick={() => removeLine(idx)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Quote total */}
        <div className="flex justify-end mt-3">
          <div className="text-sm font-bold text-gray-900">
            Total: <span className="font-mono">${quoteTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
        >
          {submitting ? 'Creating...' : 'Create Quote'}
        </button>
        <Link
          href="/sales/quotes"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
