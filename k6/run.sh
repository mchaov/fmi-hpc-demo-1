#!/bin/sh
set -eu

# All regular k6 invocations run directly. Smoke also verifies the final flush.
if [ "${1:-}" = run ]; then
  for argument in "$@"; do
    case "$argument" in
      smoke.js|*/smoke.js)
        SMOKE_INVOCATION=$(cat /proc/sys/kernel/random/uuid)
        export SMOKE_INVOCATION
        if k6 "$@"; then
          unset K6_OUT
          if k6 run --quiet /scripts/verify-smoke.js; then
            echo 'Smoke result: PASS'
            exit 0
          fi
          echo 'Smoke result: FAIL (Prometheus ingestion)' >&2
          exit 1
        else
          status=$?
          echo 'Smoke result: FAIL (HTTP test)' >&2
          exit "$status"
        fi
        ;;
    esac
  done
fi
exec k6 "$@"
