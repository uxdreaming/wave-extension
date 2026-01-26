#!/bin/bash
# Creates placeholder icons for Wave extension
# Requires imagemagick: sudo apt install imagemagick

for size in 16 32 48 128; do
  convert -size ${size}x${size} xc:'#3b82f6' \
    -fill white -gravity center \
    -pointsize $((size/2)) -annotate +0+0 '🌊' \
    "wave-${size}.png" 2>/dev/null || \
  # Fallback: create solid color icon
  convert -size ${size}x${size} xc:'#3b82f6' "wave-${size}.png"
done

echo "Icons created"
