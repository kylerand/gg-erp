import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Finding {
  status: 'works' | 'broken' | 'missing' | 'divergent';
  severity: 'low' | 'medium' | 'high' | 'critical';
  area: string;
  summary: string;
  expected: string;
  observed: string;
  url: string;
  recordedAt: string;
}

export class FindingsCollector {
  private items: Finding[] = [];
  private execSummary = '';

  add(f: Finding): void {
    this.items.push(f);
  }

  setExecutiveSummary(s: string): void {
    this.execSummary = s;
  }

  get count(): number {
    return this.items.length;
  }

  asMarkdown(meta: { app: string; role: string; iterations: number; durationMs: number; usdSpent: number }): string {
    const byStatus: Record<Finding['status'], Finding[]> = {
      broken: [],
      missing: [],
      divergent: [],
      works: [],
    };
    for (const f of this.items) byStatus[f.status].push(f);

    const lines: string[] = [];
    lines.push(`# QA Agent — ${meta.app} (as ${meta.role})`);
    lines.push('');
    lines.push(`Run on ${new Date().toISOString().slice(0, 19)}Z. Model spent ` +
      `${meta.iterations} iterations / ${(meta.durationMs / 1000).toFixed(0)}s / ` +
      `~$${meta.usdSpent.toFixed(2)}.`);
    lines.push('');

    lines.push('## Executive summary');
    lines.push(this.execSummary || '*Agent did not record an executive summary.*');
    lines.push('');

    lines.push('## Findings overview');
    lines.push('');
    lines.push('| Status | Count |');
    lines.push('|---|---:|');
    for (const status of ['broken', 'missing', 'divergent', 'works'] as const) {
      lines.push(`| **${status}** | ${byStatus[status].length} |`);
    }
    lines.push('');

    for (const status of ['broken', 'missing', 'divergent', 'works'] as const) {
      if (byStatus[status].length === 0) continue;
      lines.push(`## ${status.toUpperCase()} (${byStatus[status].length})`);
      lines.push('');
      for (const f of byStatus[status]) {
        const sev = f.severity === 'critical'
          ? '🔴'
          : f.severity === 'high'
            ? '🟠'
            : f.severity === 'medium'
              ? '🟡'
              : '⚪';
        lines.push(`### ${sev} ${f.area} — ${f.summary}`);
        if (f.url) lines.push(`*${f.url}*`);
        lines.push('');
        lines.push(`- **Expected:** ${f.expected}`);
        lines.push(`- **Observed:** ${f.observed}`);
        lines.push(`- **Severity:** ${f.severity}`);
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  write(filePath: string, meta: { app: string; role: string; iterations: number; durationMs: number; usdSpent: number }): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, this.asMarkdown(meta));
  }
}
