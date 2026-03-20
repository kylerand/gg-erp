'use client';
import { useEffect, useState } from 'react';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { listSops, createSop, listInspectionTemplates, type SopDocument, type InspectionTemplate } from '@/lib/api-client';

const STATUS_CLASSES: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-800',
  DRAFT:     'bg-yellow-100 text-yellow-800',
  RETIRED:   'bg-gray-100 text-gray-500',
};

export default function SOPLibraryPage() {
  const [tab, setTab] = useState<'sops' | 'templates'>('sops');
  const [sops, setSops] = useState<SopDocument[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<InspectionTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT' | 'RETIRED'>('PUBLISHED');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      if (tab === 'sops') {
        const params: { status?: string; search?: string } = {};
        if (statusFilter !== 'ALL') params.status = statusFilter;
        if (search) params.search = search;
        const res = await listSops(params);
        setSops(res.items);
      } else {
        const res = await listInspectionTemplates();
        setTemplates(res.items);
      }
    } catch {
      toast.error(`Failed to load ${tab === 'sops' ? 'SOPs' : 'inspection templates'}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [tab, statusFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

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
        description="Standard Operating Procedures &amp; Inspection Templates"
        action={
          tab === 'sops' ? (
            <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => setShowCreate(s => !s)}>
              {showCreate ? 'Cancel' : '+ New SOP'}
            </Button>
          ) : null
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([['sops', 'SOP Documents'], ['templates', 'Inspection Templates']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setSelectedTemplate(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === key ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sops' && (
        <>
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
        </>
      )}

      {tab === 'templates' && (
        <>
          {selectedTemplate ? (
            <div>
              <button
                onClick={() => setSelectedTemplate(null)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
              >
                ← Back to templates
              </button>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">{selectedTemplate.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{selectedTemplate.items?.length ?? 0} inspection items</p>
                </div>
                <ol className="divide-y divide-gray-100">
                  {(selectedTemplate.items ?? []).sort((a, b) => a.ordinal - b.ordinal).map((item, idx) => (
                    <li key={item.id} className="px-5 py-3 flex gap-3">
                      <span className="text-xs font-mono text-gray-400 w-5 shrink-0 pt-0.5">{idx + 1}.</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.name}</p>
                        {item.message && <p className="text-xs text-gray-500 mt-0.5">{item.message}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <>
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1,2,3,4,5,6].map(i => <div key={i} className="h-28 bg-gray-100 rounded-lg animate-pulse" />)}
                </div>
              ) : templates.length === 0 ? (
                <EmptyState
                  icon="🔍"
                  title="No inspection templates"
                  description="Run Wave H to import templates from ShopMonkey: SM_EMAIL=… SM_PASSWORD=… npm run migrate H"
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {templates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplate(t)}
                      className="text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-yellow-400 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-2xl">📋</span>
                        {t.deleted && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600">Archived</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400 mt-1">{t.items?.length ?? '—'} items · Updated {new Date(t.updatedAt).toLocaleDateString()}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
