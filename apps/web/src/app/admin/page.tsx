import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import {
  getLiveErpAdminConfigurationDomains,
  type ErpAdminConfigurationCategory,
  type ErpAdminConfigurationDescriptor,
} from '@gg-erp/domain';
import { Activity, FileSearch, Receipt, ShieldCheck, Users, type LucideIcon } from 'lucide-react';

const CATEGORY_LABELS: Record<ErpAdminConfigurationCategory, string> = {
  access: 'Access',
  accounting: 'Accounting',
  integrations: 'Integrations',
  audit: 'Audit',
};

const CATEGORY_ICONS: Record<ErpAdminConfigurationCategory, LucideIcon> = {
  access: Users,
  accounting: Receipt,
  integrations: Activity,
  audit: FileSearch,
};

export default function AdminPage() {
  const domains = getLiveErpAdminConfigurationDomains();

  return (
    <div>
      <PageHeader
        title="Admin"
        description={`${domains.length} live configuration domains for access, accounting, integrations, and audit`}
      />

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {domains.map((domain) => {
          const Icon = CATEGORY_ICONS[domain.category];
          return (
            <Link
              key={domain.key}
              href={domain.route}
              className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-yellow-400"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF3E8] text-[#B1581B]">
                  <Icon size={19} />
                </div>
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[0.7rem] font-semibold uppercase text-green-700">
                  Live
                </span>
              </div>
              <div className="text-sm font-semibold text-gray-900">{domain.label}</div>
              <div className="mt-1 text-xs leading-5 text-gray-500">{domain.ctaLabel}</div>
            </Link>
          );
        })}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Configuration Catalog
          </h2>
          <span className="text-xs font-medium text-gray-500">
            Live admin destinations
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {domains.map((domain) => (
            <AdminConfigCard key={domain.key} domain={domain} />
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminConfigCard({ domain }: { domain: ErpAdminConfigurationDescriptor }) {
  const Icon = CATEGORY_ICONS[domain.category];

  return (
    <Link
      href={domain.route}
      className="rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-yellow-400"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">{domain.label}</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[0.7rem] font-semibold text-gray-500">
              {CATEGORY_LABELS[domain.category]}
            </span>
          </div>
          <p className="mt-2 text-sm leading-5 text-gray-600">{domain.description}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FFF3E8] text-[#B1581B]">
          <Icon size={19} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <AdminConfigList label="Live Signals" values={domain.liveSignals} />
        <AdminConfigList label="Actions" values={domain.actions} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-green-700">
          <ShieldCheck size={15} />
          Ready
        </span>
        <span className="font-semibold text-[#B1581B]">{domain.ctaLabel}</span>
      </div>
    </Link>
  );
}

function AdminConfigList({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="space-y-1.5">
        {values.map((value) => (
          <div key={value} className="text-sm text-gray-600">
            {value}
          </div>
        ))}
      </div>
    </div>
  );
}
