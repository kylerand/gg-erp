export type MaterialReadiness = 'READY' | 'PARTIAL' | 'NOT_READY';

export function MaterialReadinessBadge({
  status,
  shortageCount,
}: {
  status: MaterialReadiness;
  shortageCount?: number;
}) {
  if (status === 'READY') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-green-100 text-green-800 border-green-200">
        ✓ Parts Ready
      </span>
    );
  }

  if (status === 'PARTIAL') {
    const label =
      shortageCount !== undefined ? `⚠ ${shortageCount} shortage(s)` : '⚠ Partial shortage';
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-amber-100 text-amber-800 border-amber-200">
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-red-100 text-red-800 border-red-200">
      ✗ Parts Not Ready
    </span>
  );
}
