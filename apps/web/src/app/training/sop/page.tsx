'use client';
import { useEffect, useState } from 'react';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { listSops, createSop, type SopDocument } from '@/lib/api-client';

const STATUS_CLASSES: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-800',
  DRAFT:     'bg-yellow-100 text-yellow-800',
  RETIRED:   'bg-gray-100 text-gray-500',
};

export default function SOPLibraryPage() {
  const [sops, setSops] = useState<SopDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT' | 'RETIRED'>('PUBLISHED');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params: { status?: string; search?: string } = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (search) params.search = search;
      const res = await listSops(params);
      setSops(res.items);
    } catch {
      toast.error('Failed to load SOPs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const form = new FormData(e.currentTarget);
    try {
      const sop = await createSop({
        documentCode: form.get('documentCode') as string,
        title: form.get('title') as string,
        category: (form.get('category') as string) || undefined,
      });
      setSops(prev => [sop, ...prev]);
      setShowCreate(false);
      toast.success(`SOP ${sop.documentCode} created`);
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="SOP Library"
        description="Standard Operating Procedures"
        action={
          <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => setShowCreate(s => !s)}>
            {showCreate ? 'Cancel' : '+ New SOP'}
          </Button>
        }
      />

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-4 mb-6 space-y-3">
          <p className="text-sm font-medium text-gray-700">New SOP Document</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Document Code *</label>
              <Input name="documentCode" placeholder="SOP-BAT-002" required />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Title *</label>
              <Input name="title" placeholder="Battery Pack Removal" required />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Category</label>
              <Input name="category" placeholder="Battery Systems" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={creating} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900">
              {creating ? 'Creating…' : 'Create Draft'}
            </Button>
          </div>
        </form>
      )}

      <div className="flex gap-3 mb-4 flex-wrap">
        <Input
          placeholder="Search SOPs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-2">
          {(['ALL', 'PUBLISHED', 'DRAFT', 'RETIRED'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${statusFilter === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}</div>
      ) : sops.length === 0 ? (
        <EmptyState icon="📖" title="No SOPs found" description="Try adjusting your search or filter, or create a new SOP." />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Rev</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sops.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-gray-700">{s.documentCode}</td>
                  <td className="px-4 py-3 text-gray-900">{s.title}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.category ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {s.currentVersion ? `v${s.currentVersion.versionNumber}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[s.documentStatus] ?? 'bg-gray-100 text-gray-500'}`}>
                      {s.documentStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(s.updatedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" onClick={() => toast.info(`SOP ${s.documentCode} viewer coming soon`)}>View</Button>
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
