#!/usr/bin/env bash
# Concatenate per-scene mp3s and mux the combined audio onto the Playwright video.
# Usage: mux.sh <app>    # app = erp | floor-tech | training

set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH

APP="${1:?usage: mux.sh <app>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIO_DIR="$ROOT/audio/$APP"
OUT_DIR="$ROOT/out"
RAW="$OUT_DIR/$APP-raw.webm"
CONCAT_LIST="$OUT_DIR/$APP-concat.txt"
COMBINED_MP3="$OUT_DIR/$APP-combined.mp3"
FINAL_MP4="$OUT_DIR/$APP-walkthrough.mp4"

if [[ ! -f "$RAW" ]]; then echo "Missing $RAW" >&2; exit 1; fi
if [[ ! -f "$AUDIO_DIR/durations.json" ]]; then echo "Missing $AUDIO_DIR/durations.json" >&2; exit 1; fi

# Build ffmpeg concat list in scene order.
python3 -c "
import json, os
items = json.load(open('$AUDIO_DIR/durations.json'))
with open('$CONCAT_LIST', 'w') as f:
    for it in items:
        f.write(f\"file '{os.path.abspath(os.path.join('$AUDIO_DIR', it['mp3']))}'\n\")
print('wrote concat list with', len(items), 'clips')
"

# Concatenate mp3s (copy, no re-encode).
ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" -c copy "$COMBINED_MP3" 2>/dev/null
echo "combined audio: $(du -sh "$COMBINED_MP3" | cut -f1)"

# Mux video+audio. Use -shortest so the output length matches whichever is shorter
# (they should match, modulo frame-level rounding).
ffmpeg -y \
  -i "$RAW" \
  -i "$COMBINED_MP3" \
  -c:v libx264 -pix_fmt yuv420p -preset medium -crf 23 \
  -c:a aac -b:a 160k \
  -shortest \
  "$FINAL_MP4" 2>&1 | tail -3

echo "=> $FINAL_MP4 ($(du -sh "$FINAL_MP4" | cut -f1))"
