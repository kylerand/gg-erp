interface SafetyWarningProps {
  warnings: Array<{ severity: 'danger' | 'warning' | 'caution'; text: string }>;
}

const SEVERITY_STYLES = {
  danger: 'bg-red-50 border-red-400 text-red-800',
  warning: 'bg-orange-50 border-orange-400 text-orange-800',
  caution: 'bg-yellow-50 border-yellow-400 text-yellow-800',
};

const SEVERITY_ICONS = {
  danger: '🚨',
  warning: '⚠️',
  caution: '⚡',
};

export function SafetyWarning({ warnings }: SafetyWarningProps) {
  if (!warnings?.length) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={`flex gap-3 p-3 border-l-4 rounded-r-lg ${SEVERITY_STYLES[w.severity] ?? SEVERITY_STYLES.caution}`}
        >
          <span className="text-lg shrink-0">{SEVERITY_ICONS[w.severity] ?? '⚠️'}</span>
          <p className="text-sm font-medium">{w.text}</p>
        </div>
      ))}
    </div>
  );
}
