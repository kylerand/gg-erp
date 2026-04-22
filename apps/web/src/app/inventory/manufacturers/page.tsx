'use client';
import { useEffect, useState, useCallback } from 'react';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listManufacturers, createManufacturer, type Manufacturer } from '@/lib/api-client';
import { Input } from '@/components/ui/input';

export default function ManufacturersPage() {
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', manufacturerCode: '', website: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listManufacturers();
      setManufacturers(r.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createManufacturer({
        manufacturerCode: form.manufacturerCode.trim(),
        name: form.name.trim(),
        website: form.website.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({ name: '', manufacturerCode: '', website: '', notes: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create manufacturer');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Manufacturers" description={`${manufacturers.length} total`} />
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : 'New manufacturer'}
        </button>
      </div>
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-2"
        >
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Name</span>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Code</span>
            <Input
              required
              value={form.manufacturerCode}
              onChange={(e) => setForm((f) => ({ ...f, manufacturerCode: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Website</span>
            <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Notes</span>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          {error && <div className="col-span-full text-sm text-red-600">{error}</div>}
          <div className="col-span-full">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <LoadingSkeleton rows={4} cols={3} />
      ) : manufacturers.length === 0 ? (
        <EmptyState icon="🏭" title="No manufacturers yet" description="Add your first manufacturer above." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Website</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {manufacturers.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{m.manufacturerCode}</td>
                  <td className="px-4 py-2 text-gray-900">{m.name}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {m.website ? (
                      <a href={m.website} target="_blank" rel="noreferrer" className="hover:underline">
                        {m.website}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={m.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
