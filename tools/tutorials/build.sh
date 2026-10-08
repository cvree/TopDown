#!/usr/bin/env bash
# Xerath School, end to end: voice, picture, sound, video.
#   KOKORO_DIR=<models> tools/tutorials/build.sh [episode-id ...]
set -euo pipefail
cd "$(dirname "$0")/../.."
BUILD=tutorial-build
OUT=docs/xerath-tutorials
ONLY=$(IFS=,; echo "$*")
python3 tools/tutorials/tts.py "$BUILD"
if [ -n "$ONLY" ]; then node tools/tutorials/render.mjs "$BUILD" --only "$ONLY"; else node tools/tutorials/render.mjs "$BUILD"; fi
python3 tools/tutorials/mix.py "$BUILD" "$OUT" "$@"
