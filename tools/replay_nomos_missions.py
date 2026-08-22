#!/usr/bin/env python3
"""Compatibility CLI for the V5.5 TypeScript replay engine."""
from __future__ import annotations
import subprocess
import sys
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
if not pnpm:
    raise SystemExit("pnpm is required to run the V5.5 TypeScript replay engine")
raise SystemExit(subprocess.call([pnpm, "exec", "tsx", "scripts/replay-v55-missions.ts"], cwd=root))
