import { StatusBadge } from '../primitives/StatusBadge';

export interface QueueItem {
  id: string;
  number: string;
  title: string;
  status: string;
  assignee?: string;
  age?: string;
  priority?: 'p1' | 'p2' | 'p3';
}

const PRIORITY_ICONS: Record<string, string> = { p1: '🔴', p2: '🟡', p3: '🔵' };

export function QueueList({
  items,
  onAction,
  actionLabel = 'Open',
  emptyMessage = 'No items in queue',
}: {
  items: QueueItem[];
  onAction?: (item: QueueItem) => void;
  actionLabel?: string;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">{emptyMessage}</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-4 py-3 px-1">
          {item.priority && (
            <span className="text-base" role="img" aria-label={`Priority ${item.priority}`}>
              {PRIORITY_ICONS[item.priority]}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-gray-500">{item.number}</span>
              <StatusBadge status={item.status} />
            </div>
            <p className="text-sm font-medium text-gray-900 truncate mt-0.5">{item.title}</p>
            {(item.assignee ?? item.age) && (
              <p className="text-xs text-gray-400 mt-0.5">
                {item.assignee && <span>{item.assignee}</span>}
                {item.assignee && item.age && <span className="mx-1">·</span>}
                {item.age && <span>{item.age}</span>}
              </p>
            )}
          </div>
          {onAction && (
            <button
              onClick={() => onAction(item)}
              className="text-xs font-medium text-yellow-700 hover:text-yellow-900 border border-yellow-200 hover:border-yellow-400 px-2 py-1 rounded transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
