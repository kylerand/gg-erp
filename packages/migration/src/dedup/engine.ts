import type { ImportEntityType } from '../types.js';

export interface DedupCandidate {
  entityType: ImportEntityType;
  candidateAId: string;
  candidateBId: string;
  confidence: number;
  matchField: string;
}

export function findCustomerDuplicates(
  records: Array<{ id: string; email: string; firstName?: string; lastName?: string; phone?: string }>,
): DedupCandidate[] {
  const candidates: DedupCandidate[] = [];
  const byEmail = new Map<string, string[]>();

  for (const r of records) {
    if (!r.email) continue;
    const key = r.email.toLowerCase().trim();
    const existing = byEmail.get(key) ?? [];
    existing.push(r.id);
    byEmail.set(key, existing);
  }

  for (const [, ids] of byEmail) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length - 1; i++) {
      candidates.push({
        entityType: 'CUSTOMER',
        candidateAId: ids[i],
        candidateBId: ids[i + 1],
        confidence: 1.0,
        matchField: 'email',
      });
    }
  }

  return candidates;
}

export function findAssetDuplicates(
  records: Array<{ id: string; vin?: string }>,
): DedupCandidate[] {
  const candidates: DedupCandidate[] = [];
  const byVin = new Map<string, string[]>();

  for (const r of records) {
    if (!r.vin) continue;
    const existing = byVin.get(r.vin) ?? [];
    existing.push(r.id);
    byVin.set(r.vin, existing);
  }

  for (const [, ids] of byVin) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length - 1; i++) {
      candidates.push({
        entityType: 'ASSET',
        candidateAId: ids[i],
        candidateBId: ids[i + 1],
        confidence: 1.0,
        matchField: 'vin',
      });
    }
  }

  return candidates;
}

export function findPartDuplicates(
  records: Array<{ id: string; sku: string }>,
): DedupCandidate[] {
  const candidates: DedupCandidate[] = [];
  const bySku = new Map<string, string[]>();

  for (const r of records) {
    if (!r.sku) continue;
    const key = r.sku.toUpperCase().trim();
    const existing = bySku.get(key) ?? [];
    existing.push(r.id);
    bySku.set(key, existing);
  }

  for (const [, ids] of bySku) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length - 1; i++) {
      candidates.push({
        entityType: 'PART',
        candidateAId: ids[i],
        candidateBId: ids[i + 1],
        confidence: 1.0,
        matchField: 'sku',
      });
    }
  }

  return candidates;
}
