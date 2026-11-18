#!/bin/bash
# Make the virtual environment inside this folder and install what the backend needs.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if command -v uv >/dev/null; then
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python -r requirements.txt
else
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
echo "Done. Start with ./launch.sh"
