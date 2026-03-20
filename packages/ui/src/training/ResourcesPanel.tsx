interface ResourcesPanelProps {
  tools?: string[];
  materials?: string[];
}

export function ResourcesPanel({ tools, materials }: ResourcesPanelProps) {
  if (!tools?.length && !materials?.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {tools && tools.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-800 mb-2 flex items-center gap-1">
            🔧 Tools Required
          </h4>
          <ul className="space-y-1">
            {tools.map((t, i) => (
              <li key={i} className="text-sm text-blue-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
      {materials && materials.length > 0 && (
        <div className="bg-green-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-1">
            📦 Materials Needed
          </h4>
          <ul className="space-y-1">
            {materials.map((m, i) => (
              <li key={i} className="text-sm text-green-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full shrink-0" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
