#!/usr/bin/env python3
"""Command-line launcher for the Blender GLB voxelizer."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional


TOOL_DIR = Path(__file__).resolve().parent
BLENDER_SCRIPT = TOOL_DIR / "blender_voxelize.py"


def find_blender(explicit: Optional[str]) -> str:
    """Return a Blender executable or fail with an actionable message."""
    candidates = [
        explicit,
        os.environ.get("BLENDER"),
        shutil.which("blender"),
        "/Applications/Blender.app/Contents/MacOS/Blender",
        "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe",
        "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
        "C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe",
        "C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())

    raise SystemExit(
        "Blender was not found. Install Blender 3.6+ and either put `blender` on "
        "PATH, set BLENDER=/path/to/blender, or pass --blender /path/to/blender."
    )


def output_path_for(
    input_path: Path, output: Optional[Path], output_dir: Optional[Path]
) -> Path:
    if output:
        return output.resolve()
    destination = (output_dir or input_path.parent).resolve()
    return destination / f"{input_path.stem}.voxel.glb"


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Voxelize one or more GLB files with Blender's Blocks remesh while "
            "projecting source texture colors onto the voxel faces."
        )
    )
    parser.add_argument("inputs", nargs="+", type=Path, metavar="INPUT.glb")
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output GLB path (only valid with one input).",
    )
    destination.add_argument(
        "--output-dir",
        type=Path,
        help="Directory for <input>.voxel.glb outputs.",
    )
    parser.add_argument(
        "-d",
        "--depth",
        "--factor",
        type=int,
        default=5,
        metavar="N",
        help="Blocks Remesh octree depth, 1-10 (default: 5; larger = smaller voxels).",
    )
    parser.add_argument(
        "--color-samples",
        type=int,
        choices=(1, 5),
        default=5,
        help=(
            "Texture samples per voxel face: 1=center, 5=center+corners "
            "(default: 5, more representative on texture boundaries)."
        ),
    )
    parser.add_argument(
        "--blender",
        help="Path to the Blender executable. BLENDER environment variable is also supported.",
    )
    parser.add_argument(
        "--keep-largest",
        action="store_true",
        help="Remove small disconnected pieces during remeshing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without running Blender.",
    )
    args = parser.parse_args(argv)

    if not 1 <= args.depth <= 10:
        parser.error("--depth must be between 1 and 10")
    if args.output and len(args.inputs) != 1:
        parser.error("--output can only be used with one input; use --output-dir for batches")
    return args


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    blender = find_blender(args.blender)

    jobs: list[tuple[Path, Path]] = []
    for raw_input in args.inputs:
        input_path = raw_input.resolve()
        if not input_path.is_file():
            raise SystemExit(f"Input does not exist: {input_path}")
        if input_path.suffix.lower() != ".glb":
            raise SystemExit(f"Input must be a .glb file: {input_path}")
        output_path = output_path_for(input_path, args.output, args.output_dir)
        if output_path == input_path:
            raise SystemExit(
                f"Output must differ from input to avoid overwriting the source: {input_path}"
            )
        jobs.append(
            (
                input_path,
                output_path,
            )
        )

    for input_path, output_path in jobs:
        command = [
            blender,
            "--background",
            "--factory-startup",
            "--python",
            str(BLENDER_SCRIPT),
            "--",
            str(input_path),
            str(output_path),
            "--depth",
            str(args.depth),
            "--color-samples",
            str(args.color_samples),
        ]
        if args.keep_largest:
            command.append("--keep-largest")

        print(f"Voxelizing {input_path.name} -> {output_path}")
        if args.dry_run:
            print(" ".join(repr(part) if " " in part else part for part in command))
            continue

        output_path.parent.mkdir(parents=True, exist_ok=True)
        completed = subprocess.run(command, check=False)
        if completed.returncode:
            return completed.returncode
        if not output_path.is_file():
            print(f"Blender exited successfully but did not create: {output_path}", file=sys.stderr)
            return 1

    if not args.dry_run:
        print(f"Completed {len(jobs)} file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
