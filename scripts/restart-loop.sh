#!/usr/bin/env bash

set -euo pipefail

RESTART_SECONDS=$((6 * 60 * 60))

echo "======================================"
echo " Demons-SMP 6-hour restart loop"
echo " Restart interval: 6 hours"
echo "======================================"

while true; do
    echo "[Demons-SMP] Starting server..."

    bash startup.sh &
    SERVER_PID=$!

    echo "[Demons-SMP] Server PID: $SERVER_PID"
    echo "[Demons-SMP] Running for 6 hours..."

    sleep "$RESTART_SECONDS"

    echo "[Demons-SMP] 6 hours reached."
    echo "[Demons-SMP] Sending graceful shutdown..."

    if kill -0 "$SERVER_PID" 2>/dev/null; then
        kill -TERM "$SERVER_PID" 2>/dev/null || true

        for i in {1..30}; do
            if ! kill -0 "$SERVER_PID" 2>/dev/null; then
                break
            fi
            sleep 1
        done

        kill -KILL "$SERVER_PID" 2>/dev/null || true
    fi

    echo "[Demons-SMP] Restarting..."
    sleep 5
done
