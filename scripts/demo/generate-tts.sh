#!/usr/bin/env bash
# Generate per-scene audio from scenes/<app>.json using AWS Polly neural voice.
# Writes mp3 per scene and a durations.json next to it.
#
# Usage: generate-tts.sh <app>    # app = erp | floor-tech | training

set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH

APP="${1:?usage: generate-tts.sh <app>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENES_FILE="$ROOT/scenes/$APP.json"
OUT_DIR="$ROOT/audio/$APP"
VOICE="${POLLY_VOICE:-Joanna}"

if [[ ! -f "$SCENES_FILE" ]]; then
  echo "Missing $SCENES_FILE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.mp3 "$OUT_DIR/durations.json"

SCENE_COUNT=$(python3 -c "import json; print(len(json.load(open('$SCENES_FILE'))['scenes']))")
echo "[$APP] generating audio for $SCENE_COUNT scenes with voice=$VOICE"

declare -a DURATIONS=()
for i in $(seq 0 $((SCENE_COUNT-1))); do
  ID=$(python3 -c "import json; print(json.load(open('$SCENES_FILE'))['scenes'][$i]['id'])")
  TEXT=$(python3 -c "import json; print(json.load(open('$SCENES_FILE'))['scenes'][$i]['narration'])")
  MP3="$OUT_DIR/$ID.mp3"

  aws polly synthesize-speech \
    --engine neural \
    --language-code en-US \
    --voice-id "$VOICE" \
    --output-format mp3 \
    --text "$TEXT" \
    "$MP3" > /dev/null

  DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$MP3")
  DURATIONS+=("{\"id\":\"$ID\",\"mp3\":\"$ID.mp3\",\"duration\":$DUR}")
  printf "  %-30s %.2fs\n" "$ID" "$DUR"
done

# Write durations.json
python3 -c "
import json
items = [$(IFS=,; echo "${DURATIONS[*]}")]
with open('$OUT_DIR/durations.json', 'w') as f:
    json.dump(items, f, indent=2)
print('[$APP] wrote $OUT_DIR/durations.json')
"
