#!/bin/bash
# extract_text.sh <image_path>
# Deterministic on-image TEXT extraction via tesseract OCR at full resolution +
# 2x upscale + 4 quadrant tiles. Prints all recovered text to stdout (deduped lines).
# Purpose: catch small / fine-print / stylized on-image text that a single downscaled
# vision read can miss. Pair this with the two native-vision transcription passes;
# union all three text sources before the banned-word grep.
set -euo pipefail
img="${1:?usage: extract_text.sh <image_path>}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
{
  # 1) full-resolution OCR
  tesseract "$img" stdout 2>/dev/null || true
  # 2) 2x upscale (recovers small print)
  ffmpeg -nostdin -loglevel error -i "$img" -vf "scale=iw*2:ih*2:flags=lanczos" "$tmp/up.png" -y 2>/dev/null || true
  [ -f "$tmp/up.png" ] && tesseract "$tmp/up.png" stdout 2>/dev/null || true
  # 3) four quadrant tiles at full res (badges / corners / bottom bars)
  for spec in "tl:0:0" "tr:iw/2:0" "bl:0:ih/2" "br:iw/2:ih/2"; do
    name="${spec%%:*}"; off="${spec#*:}"
    ffmpeg -nostdin -loglevel error -i "$img" -vf "crop=iw/2:ih/2:${off}" "$tmp/$name.png" -y 2>/dev/null || true
    [ -f "$tmp/$name.png" ] && tesseract "$tmp/$name.png" stdout 2>/dev/null || true
  done
} | sed '/^[[:space:]]*$/d' | awk '!seen[$0]++'
