'use client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactPlayer = require('react-player').default;
import { useState, useRef } from 'react';

interface VideoPlayerProps {
  videoUrl: string;
  onProgress?: (percentage: number) => void;
  onComplete?: () => void;
  autoPlay?: boolean;
  className?: string;
}

export function VideoPlayer({ videoUrl, onProgress, onComplete, autoPlay = false, className }: VideoPlayerProps) {
  const [played, setPlayed] = useState(0);
  const [completed, setCompleted] = useState(false);
  const completedRef = useRef(false);

  function handleProgress(state: { played: number }) {
    const pct = Math.round(state.played * 100);
    setPlayed(pct);
    onProgress?.(pct);
    if (pct >= 90 && !completedRef.current) {
      completedRef.current = true;
      setCompleted(true);
      onComplete?.();
    }
  }

  return (
    <div className={`relative bg-black rounded-lg overflow-hidden ${className ?? ''}`}>
      <div className="aspect-video">
        <ReactPlayer
          url={videoUrl}
          width="100%"
          height="100%"
          controls
          playing={autoPlay}
          onProgress={handleProgress}
          config={{
            youtube: { playerVars: { modestbranding: 1 } },
          }}
        />
      </div>
      <div className="px-3 py-2 bg-gray-900 flex items-center gap-3">
        <div className="flex-1 bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-yellow-400 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${played}%` }}
          />
        </div>
        <span className="text-xs text-gray-400 shrink-0">{played}% watched</span>
        {completed && (
          <span className="text-xs text-green-400 font-semibold shrink-0">✓ Complete</span>
        )}
      </div>
    </div>
  );
}
