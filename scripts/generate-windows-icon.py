"""Backward-compatible entry point for the unified cross-platform icon generator."""

import runpy
import sys
from pathlib import Path


sys.argv = [sys.argv[0], "--platform", "desktop"]
runpy.run_path(str(Path(__file__).with_name("generate-app-icons.py")), run_name="__main__")
