'use client';
import { useState } from 'react';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface SOP {
  id: string;
  code: string;
  title: string;
  category: string;
  revision: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  lastUpdated: string;
}

const MOCK_SOPS: SOP[] = [
  { id: 'sop1', code: 'SOP-BAT-001', title: 'Battery Pack Removal & Installation', category: 'Battery Systems', revision: 'v3.1', status: 'ACTIVE', lastUpdated: '2026-02-15' },
  { id: 'sop2', code: 'SOP-CTL-001', title: 'Controller Programming & Configuration', category: 'Electronics', revision: 'v2.0', status: 'ACTIVE', lastUpdated: '2026-01-20' },
  { id: 'sop3', code: 'SOP-QC-001', title: 'Pre-Delivery Quality Inspection', category: 'Quality Control', revision: 'v4.2', status: 'ACTIVE', lastUpdated: '2026-03-01' },
  { id: 'sop4', code: 'SOP-WRG-001', title: 'Wiring Harness Installation Guide', category: 'Electrical', revision: 'v1.5', status: 'DRAFT', lastUpdated: '2026-03-08' },
  { id: 'sop5', code: 'SOP-BAT-000', title: 'Legacy Battery Procedure (deprecated)', category: 'Battery Systems', revision: 'v1.0', status: 'ARCHIVED', lastUpdated: '2025-06-01' },
];

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE:   'bg-green-100 text-green-800',
  DRAFT:    'bg-yellow-100 text-yellow-800',
  ARCHIVED: 'bg-gray-100 text-gray-500',
};

export default function SOPLibraryPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DRAFT' | 'ARCHIVED'>('ACTIVE');

  const filtered = MOCK_SOPS.filter(s =>
    (statusFilter === 'ALL' || s.status === statusFilter) &&
    (search === '' || s.title.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <PageHeader title="SOP Library" description="Standard Operating Procedures" />
      <div className="flex gap-3 mb-4 flex-wrap">
        <Input placeholder="Search SOPs…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <div className="flex gap-2">
          {(['ALL', 'ACTIVE', 'DRAFT', 'ARCHIVED'] as const).map(f => (
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
      {filtered.length === 0 ? (
        <EmptyState icon="📖" title="No SOPs found" description="Try adjusting your search or filter." />
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
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-gray-700">{s.code}</td>
                  <td className="px-4 py-3 text-gray-900">{s.title}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.category}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.revision}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[s.status]}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(s.lastUpdated).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" onClick={() => toast.info(`Opening ${s.code}…`)}>View</Button>
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
