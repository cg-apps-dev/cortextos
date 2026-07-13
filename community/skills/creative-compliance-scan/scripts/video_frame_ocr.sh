#!/bin/bash
# video_frame_ocr.sh <video_path> [output_dir]
# Sample the full video at 1fps, OCR every full frame through extract_text.sh, and print
# one deduped text blob for the record's ocr_text field. All sampled frames count as ONE
# OCR source for corroboration; do not treat near-duplicate frames as independent sources.
set -euo pipefail
video="${1:?usage: video_frame_ocr.sh <video_path> [output_dir]}"
out="${2:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "$out" ]]; then
  out="$(mktemp -d)"
  cleanup=1
else
  mkdir -p "$out"
  cleanup=0
fi
trap '[[ "${cleanup:-0}" == "1" ]] && rm -rf "$out"' EXIT
frames="$out/frames_1fps"
rm -rf "$frames"
mkdir -p "$frames"
ffmpeg -nostdin -loglevel error -i "$video" -vf fps=1 "$frames/frame_%06d.png" -y
shopt -s nullglob
for frame in "$frames"/*.png; do
  "$script_dir/extract_text.sh" "$frame" || true
done | sed '/^[[:space:]]*$/d' | awk '!seen[$0]++'
