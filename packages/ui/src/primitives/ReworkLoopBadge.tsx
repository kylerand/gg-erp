export function ReworkLoopBadge({ current, max = 3 }: { current: number; max?: number }) {
  if (current === 0) return null;

  let classes: string;
  let icon: string;
  let suffix = '';

  if (current === 1) {
    classes = 'bg-green-100 text-green-800 border-green-200';
    icon = '●';
  } else if (current === 2) {
    classes = 'bg-amber-100 text-amber-800 border-amber-200';
    icon = '⚠';
  } else {
    classes = 'bg-red-100 text-red-800 border-red-200';
    icon = '⛔';
    suffix = ' — Escalate';
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes}`}
    >
      {icon} Loop {current} of {max}{suffix}
    </span>
  );
}
