#!/bin/zsh
set -eu
# Experimental command only. Never loaded by OMP and never sends it messages.
exec /Users/cryptoclock/.local/share/bitpos-harness-lab/venv/bin/python -I "${0:A:h}/replay.py" --new-run
