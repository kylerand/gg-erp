'use client';

interface BookmarkButtonProps {
  isBookmarked: boolean;
  onToggle: () => void;
  loading?: boolean;
}

export function BookmarkButton({ isBookmarked, onToggle, loading = false }: BookmarkButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark this step'}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors
        ${isBookmarked
          ? 'bg-yellow-100 border-yellow-400 text-yellow-700 hover:bg-yellow-200'
          : 'bg-white border-gray-300 text-gray-500 hover:border-yellow-400 hover:text-yellow-600'}`}
    >
      {isBookmarked ? '★' : '☆'}
      {isBookmarked ? 'Bookmarked' : 'Bookmark'}
    </button>
  );
}
