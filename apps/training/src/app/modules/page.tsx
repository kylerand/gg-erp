'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Star, Users, ChevronRight, Search } from 'lucide-react';
import { listModules, type TrainingModule } from '@/lib/api-client';

export default function ModulesPage() {
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listModules('ACTIVE')
      .then((r) => setModules(r.items.sort((a, b) => a.sortOrder - b.sortOrder)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = modules.filter(
    (m) =>
      m.moduleName.toLowerCase().includes(search.toLowerCase()) ||
      m.description?.toLowerCase().includes(search.toLowerCase()) ||
      m.moduleCode.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl" data-brand-heading="true">
          Training Modules
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {modules.length} modules available · Complete all required training
        </p>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search modules…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-2xl border border-border bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((mod, i) => (
          <Link key={mod.id} href={`/modules/${mod.moduleCode}`}>
            <div className="card p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">{mod.moduleName}</h3>
                    {mod.isRequired && (
                      <span className="flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                        Required
                      </span>
                    )}
                  </div>
                  {mod.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {mod.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {mod.estimatedTime && (
                      <span className="flex items-center gap-1">
                        <Clock size={13} />
                        {mod.estimatedTime}
                      </span>
                    )}
                    {mod.jobRoles.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Users size={13} />
                        {mod.jobRoles.slice(0, 2).join(', ')}
                        {mod.jobRoles.length > 2 && ` +${mod.jobRoles.length - 2}`}
                      </span>
                    )}
                    {mod.requiresSupervisorSignoff && (
                      <span className="flex items-center gap-1">
                        <Star size={13} />
                        Supervisor sign-off
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={20} className="mt-1 flex-shrink-0 text-muted-foreground" />
              </div>
            </div>
          </Link>
        ))}

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {search ? 'No modules match your search.' : 'No training modules available.'}
          </div>
        )}
      </div>
    </div>
  );
}
