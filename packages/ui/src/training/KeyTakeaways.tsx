interface KeyTakeawaysProps {
  whyItMatters?: string;
  commonMistakes?: string[];
}

export function KeyTakeaways({ whyItMatters, commonMistakes }: KeyTakeawaysProps) {
  if (!whyItMatters && !commonMistakes?.length) return null;
  return (
    <div className="space-y-3">
      {whyItMatters && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-purple-800 mb-1">💡 Why This Matters</h4>
          <p className="text-sm text-purple-700">{whyItMatters}</p>
        </div>
      )}
      {commonMistakes && commonMistakes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-amber-800 mb-2">⚡ Common Mistakes</h4>
          <ul className="space-y-1">
            {commonMistakes.map((m, i) => (
              <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">•</span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
