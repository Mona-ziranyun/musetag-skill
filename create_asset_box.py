#!/usr/bin/env python3
"""Copy the bundled MuseTag starter into a new directory."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", help="New or empty destination directory")
    args = parser.parse_args()

    source = Path(__file__).resolve().parent.parent / "assets" / "starter"
    destination = Path(args.destination).expanduser().resolve()

    if not source.is_dir():
        raise SystemExit(f"Starter template not found: {source}")

    if destination.exists() and any(destination.iterdir()):
        raise SystemExit(f"Destination is not empty: {destination}")

    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, dirs_exist_ok=True)
    print(f"Created MuseTag at {destination}")


if __name__ == "__main__":
    main()
