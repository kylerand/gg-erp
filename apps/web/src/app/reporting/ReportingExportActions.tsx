'use client';

import { Clipboard, Download } from 'lucide-react';
import { type ErpReportDescriptor, type ErpSavedReportViewDescriptor } from '@gg-erp/domain';
import { Button } from '@/components/ui/button';
import { downloadCsv, type CsvColumn } from '@/lib/csv-client';

interface ReportingExportActionsProps {
  reports: readonly ErpReportDescriptor[];
  savedViews: readonly ErpSavedReportViewDescriptor[];
}

const REPORT_COLUMNS: CsvColumn<ErpReportDescriptor>[] = [
  { header: 'reportKey', value: (report) => report.key },
  { header: 'label', value: (report) => report.label },
  { header: 'category', value: (report) => report.category },
  { header: 'module', value: (report) => report.module },
  { header: 'ownerContext', value: (report) => report.ownerContext },
  { header: 'cadence', value: (report) => report.cadence },
  { header: 'metricLabel', value: (report) => report.metricLabel },
  { header: 'route', value: (report) => report.route },
  { header: 'drillThroughLabel', value: (report) => report.drillThroughLabel },
  { header: 'sourceObjectKeys', value: (report) => report.sourceObjectKeys.join('|') },
  { header: 'keywords', value: (report) => report.keywords.join('|') },
];

const SAVED_VIEW_COLUMNS: CsvColumn<ErpSavedReportViewDescriptor>[] = [
  { header: 'viewKey', value: (view) => view.key },
  { header: 'label', value: (view) => view.label },
  { header: 'category', value: (view) => view.category },
  { header: 'ownerContext', value: (view) => view.ownerContext },
  { header: 'cadence', value: (view) => view.cadence },
  { header: 'route', value: (view) => view.route },
  { header: 'reportKeys', value: (view) => view.reportKeys.join('|') },
  { header: 'exportFilename', value: (view) => view.exportFilename },
  { header: 'keywords', value: (view) => view.keywords.join('|') },
];

function nowStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportingExportActions({ reports, savedViews }: ReportingExportActionsProps) {
  async function copyVisibleLinks() {
    await navigator.clipboard.writeText(
      reports.map((report) => `${report.label}: ${report.route}`).join('\n'),
    );
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <Button
        type="button"
        variant="outline"
        onClick={() => downloadCsv(`gg-report-catalog-${nowStamp()}.csv`, reports, REPORT_COLUMNS)}
      >
        <Download data-icon="inline-start" />
        Export visible reports
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          downloadCsv(`gg-saved-report-views-${nowStamp()}.csv`, savedViews, SAVED_VIEW_COLUMNS)
        }
      >
        <Download data-icon="inline-start" />
        Export saved views
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={reports.length === 0}
        onClick={() => void copyVisibleLinks()}
      >
        <Clipboard data-icon="inline-start" />
        Copy drill-through links
      </Button>
    </div>
  );
}
