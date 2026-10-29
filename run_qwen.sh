#!/usr/bin/env bash
# ==============================================================================
# AxilO - Qwen 3.5 / 3.8 Colab T4 Runner (Bash Launcher)
# Automatically creates/connects to a Tesla T4 Google Colab session, runs Qwen,
# maximizes context window (32K), exposes public tunnel, and updates models.json.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PY="$SCRIPT_DIR/run_qwen.py"

if [ ! -f "$TARGET_PY" ]; then
    TARGET_PY="/data/data/com.termux/files/home/run_qwen.py"
fi

if command -v python3 &>/dev/null; then
    exec python3 "$TARGET_PY" "$@"
elif command -v python &>/dev/null; then
    exec python "$TARGET_PY" "$@"
else
    echo "Error: Python 3 is required to run the Colab GPU environment." >&2
    exit 1
fi
