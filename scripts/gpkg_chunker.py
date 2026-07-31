#!/usr/bin/env python3
"""
Split and join GeoPackage files into chunks with a maximum size (default 50 MB).

Why this exists:
- GitHub has file-size limits, so large .gpkg files often need chunking.

Features:
- Split any file into numbered chunk files.
- Create a JSON manifest containing metadata and SHA-256 checksums.
- Reconstruct (join) from manifest with integrity verification.

Examples:
- Split:
    python scripts/gpkg_chunker.py split path/to/data.gpkg --chunk-mb 50

- Join:
  python scripts/gpkg_chunker.py join path/to/data.gpkg.manifest.json --output path/to/data.gpkg
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Dict, List

MAX_CHUNK_MB = 50.0


def sha256_of_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def sha256_of_file(path: Path, bufsize: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            block = f.read(bufsize)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def split_file(input_file: Path, output_dir: Path, chunk_mb: float) -> Path:
    if not input_file.exists() or not input_file.is_file():
        raise FileNotFoundError(f"Input file not found: {input_file}")

    if chunk_mb <= 0:
        raise ValueError("chunk-mb must be greater than 0")

    if chunk_mb > MAX_CHUNK_MB:
        raise ValueError(f"chunk-mb cannot exceed {MAX_CHUNK_MB} MB")

    chunk_size = int(chunk_mb * 1024 * 1024)
    if chunk_size <= 0:
        raise ValueError("Calculated chunk size is zero; increase chunk-mb")

    output_dir.mkdir(parents=True, exist_ok=True)

    total_size = input_file.stat().st_size
    original_sha256 = sha256_of_file(input_file)

    parts: List[Dict[str, object]] = []
    part_index = 1

    with input_file.open("rb") as src:
        while True:
            data = src.read(chunk_size)
            if not data:
                break

            part_name = f"{input_file.name}.part{part_index:03d}"
            part_path = output_dir / part_name

            with part_path.open("wb") as dst:
                dst.write(data)

            parts.append(
                {
                    "index": part_index,
                    "file": part_name,
                    "size": len(data),
                    "sha256": sha256_of_bytes(data),
                }
            )
            part_index += 1

    manifest = {
        "version": 1,
        "source_file": input_file.name,
        "source_size": total_size,
        "source_sha256": original_sha256,
        "chunk_size_bytes": chunk_size,
        "chunk_size_mb": chunk_mb,
        "parts": parts,
    }

    manifest_path = output_dir / f"{input_file.name}.manifest.json"
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=True, indent=2)

    return manifest_path


def join_file(manifest_path: Path, output_file: Path | None = None) -> Path:
    if not manifest_path.exists() or not manifest_path.is_file():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    with manifest_path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)

    parts = manifest.get("parts", [])
    if not parts:
        raise ValueError("Manifest does not contain any parts")

    base_dir = manifest_path.parent
    source_name = manifest.get("source_file", "reconstructed.gpkg")

    if output_file is None:
        output_file = base_dir / source_name

    output_file.parent.mkdir(parents=True, exist_ok=True)

    with output_file.open("wb") as out:
        for part in parts:
            part_file = part["file"]
            part_path = base_dir / part_file
            if not part_path.exists():
                raise FileNotFoundError(f"Missing part file: {part_path}")

            data = part_path.read_bytes()

            expected_size = int(part["size"])
            if len(data) != expected_size:
                raise ValueError(
                    f"Size mismatch for {part_file}: expected {expected_size}, got {len(data)}"
                )

            expected_sha = str(part["sha256"])
            actual_sha = sha256_of_bytes(data)
            if actual_sha != expected_sha:
                raise ValueError(
                    f"SHA-256 mismatch for {part_file}: expected {expected_sha}, got {actual_sha}"
                )

            out.write(data)

    expected_source_sha = str(manifest.get("source_sha256", ""))
    if expected_source_sha:
        actual_source_sha = sha256_of_file(output_file)
        if actual_source_sha != expected_source_sha:
            raise ValueError(
                "Reconstructed file checksum mismatch: "
                f"expected {expected_source_sha}, got {actual_source_sha}"
            )

    expected_source_size = int(manifest.get("source_size", 0))
    actual_size = output_file.stat().st_size
    if expected_source_size and actual_size != expected_source_size:
        raise ValueError(
            f"Reconstructed size mismatch: expected {expected_source_size}, got {actual_size}"
        )

    return output_file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Split/join large GPKG (or any file) into chunks with integrity checks."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    split_p = subparsers.add_parser("split", help="Split a file into <= chunk size parts")
    split_p.add_argument("input", type=Path, help="Path to input .gpkg file")
    split_p.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory for parts and manifest (default: <input_stem>_parts)",
    )
    split_p.add_argument(
        "--chunk-mb",
        type=float,
        default=50.0,
        help="Chunk size in MB (must be <= 50)",
    )

    join_p = subparsers.add_parser("join", help="Rebuild file from manifest + parts")
    join_p.add_argument("manifest", type=Path, help="Path to manifest JSON")
    join_p.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output file path (default: manifest folder/source filename)",
    )

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "split":
        input_file: Path = args.input
        output_dir: Path = args.output_dir or (input_file.parent / f"{input_file.stem}_parts")
        manifest_path = split_file(input_file=input_file, output_dir=output_dir, chunk_mb=args.chunk_mb)
        print("Split complete")
        print(f"Input: {input_file}")
        print(f"Output dir: {output_dir}")
        print(f"Manifest: {manifest_path}")
        return

    if args.command == "join":
        manifest: Path = args.manifest
        output: Path | None = args.output
        rebuilt = join_file(manifest_path=manifest, output_file=output)
        print("Join complete")
        print(f"Manifest: {manifest}")
        print(f"Output: {rebuilt}")
        return

    raise RuntimeError("Unknown command")


if __name__ == "__main__":
    main()
