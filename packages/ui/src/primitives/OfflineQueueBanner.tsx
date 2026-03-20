export function OfflineQueueBanner({
  isOnline,
  queuedCount,
  onReplay,
}: {
  isOnline: boolean;
  queuedCount: number;
  onReplay?: () => void;
}) {
  if (isOnline && queuedCount === 0) return null;

  if (!isOnline) {
    return (
      <div
        style={{ position: 'sticky', top: 0, zIndex: 40 }}
        className="w-full bg-amber-100 border-b border-amber-300 text-amber-900 text-sm font-medium px-4 py-2.5 flex items-center gap-2"
      >
        <span>⚠</span>
        <span>
          You&rsquo;re offline &middot; {queuedCount} action{queuedCount !== 1 ? 's' : ''} queued
        </span>
      </div>
    );
  }

  // online + queued > 0
  return (
    <div
      style={{ position: 'sticky', top: 0, zIndex: 40 }}
      className="w-full bg-blue-100 border-b border-blue-300 text-blue-900 text-sm font-medium px-4 py-2.5 flex items-center gap-2"
    >
      <span>↑</span>
      <span className="flex-1">
        {queuedCount} offline action{queuedCount !== 1 ? 's' : ''} ready to sync
      </span>
      {onReplay && (
        <button
          type="button"
          onClick={onReplay}
          className="rounded-md bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Sync Now
        </button>
      )}
    </div>
  );
}
