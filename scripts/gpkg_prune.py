#!/usr/bin/env python3
"""
Prune a GeoPackage by keeping only selected feature tables.

Default use-case in this project:
- Keep only geologisk_enhet_yta
- Remove all other layers/tables referenced by gpkg_contents
- Vacuum output to reclaim disk space

Examples:
  python scripts/gpkg_prune.py \
    --input berggrund50k-250k/berggrund50k_250k.gpkg \
    --output berggrund50k-250k/berggrund50k_250k_geology_only.gpkg \
    --keep geologisk_enhet_yta

  python scripts/gpkg_prune.py --input data.gpkg --keep geologisk_enhet_yta --dry-run
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from pathlib import Path
from typing import Iterable, List, Sequence, Set, Tuple


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def fetch_gpkg_contents(conn: sqlite3.Connection) -> List[Tuple[str, str]]:
    if not table_exists(conn, "gpkg_contents"):
        raise RuntimeError("Input file is missing gpkg_contents; not a valid GeoPackage.")

    rows = conn.execute(
        "SELECT table_name, data_type FROM gpkg_contents ORDER BY table_name"
    ).fetchall()
    return [(str(r[0]), str(r[1])) for r in rows if r and r[0]]


def fetch_geometry_column(conn: sqlite3.Connection, table_name: str) -> str | None:
    if not table_exists(conn, "gpkg_geometry_columns"):
        return None

    row = conn.execute(
        "SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?",
        (table_name,),
    ).fetchone()
    if not row:
        return None
    return str(row[0])


def drop_rtree_family(conn: sqlite3.Connection, table_name: str) -> None:
    # Drop common RTree objects tied to this table.
    pattern = f"rtree_{table_name}_%"

    triggers = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE ?",
        (pattern,),
    ).fetchall()
    for (name,) in triggers:
        conn.execute(f"DROP TRIGGER IF EXISTS {quote_ident(str(name))}")

    rtree_tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?",
        (pattern,),
    ).fetchall()
    for (name,) in rtree_tables:
        conn.execute(f"DROP TABLE IF EXISTS {quote_ident(str(name))}")


def cleanup_metadata_for_table(conn: sqlite3.Connection, table_name: str) -> None:
    candidates = [
        ("gpkg_contents", "table_name"),
        ("gpkg_geometry_columns", "table_name"),
        ("gpkg_tile_matrix", "table_name"),
        ("gpkg_tile_matrix_set", "table_name"),
        ("gpkg_data_columns", "table_name"),
        ("gpkg_2d_gridded_coverage_ancillary", "tile_matrix_set_name"),
        ("gpkg_2d_gridded_tile_ancillary", "tpudt_name"),
        ("gpkg_extensions", "table_name"),
        ("gpkg_metadata_reference", "table_name"),
    ]

    for metadata_table, key_col in candidates:
        if table_exists(conn, metadata_table):
            conn.execute(
                f"DELETE FROM {quote_ident(metadata_table)} WHERE {quote_ident(key_col)} = ?",
                (table_name,),
            )


def drop_user_table(conn: sqlite3.Connection, table_name: str) -> None:
    geom_col = fetch_geometry_column(conn, table_name)

    # Remove table-scoped extensions first.
    if table_exists(conn, "gpkg_extensions"):
        conn.execute("DELETE FROM gpkg_extensions WHERE table_name = ?", (table_name,))

    # Remove RTree objects if present.
    drop_rtree_family(conn, table_name)

    # Remove metadata rows pointing to this table.
    cleanup_metadata_for_table(conn, table_name)

    # Drop the table itself.
    conn.execute(f"DROP TABLE IF EXISTS {quote_ident(table_name)}")

    # If geometry column was known, remove extension rows tied to that column too.
    if geom_col and table_exists(conn, "gpkg_extensions"):
        conn.execute(
            "DELETE FROM gpkg_extensions WHERE table_name = ? AND column_name = ?",
            (table_name, geom_col),
        )


def validate_keep_tables(existing_tables: Sequence[str], keep_tables: Iterable[str]) -> Set[str]:
    existing_set = {t for t in existing_tables}
    keep_set = {t.strip() for t in keep_tables if t.strip()}
    missing = sorted([t for t in keep_set if t not in existing_set])
    if missing:
        raise ValueError("Keep tables not found in gpkg_contents: " + ", ".join(missing))
    if not keep_set:
        raise ValueError("At least one table must be kept.")
    return keep_set


def prune_gpkg(input_path: Path, output_path: Path, keep_tables: Sequence[str], dry_run: bool) -> dict:
    if not input_path.exists() or not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.exists():
        output_path.unlink()

    shutil.copy2(input_path, output_path)

    conn = sqlite3.connect(str(output_path))
    conn.execute("PRAGMA foreign_keys=OFF")

    try:
        contents = fetch_gpkg_contents(conn)
        all_tables = [name for name, _dtype in contents]
        keep_set = validate_keep_tables(all_tables, keep_tables)

        to_drop = [name for name in all_tables if name not in keep_set]
        kept = [name for name in all_tables if name in keep_set]

        if dry_run:
            conn.close()
            output_path.unlink(missing_ok=True)
            return {
                "kept": kept,
                "dropped": to_drop,
                "output": None,
            }

        with conn:
            for table_name in to_drop:
                drop_user_table(conn, table_name)

            # Remove orphan metadata references that no longer point to existing tables.
            if table_exists(conn, "gpkg_metadata_reference"):
                conn.execute(
                    "DELETE FROM gpkg_metadata_reference "
                    "WHERE table_name IS NOT NULL "
                    "AND table_name NOT IN (SELECT table_name FROM gpkg_contents)"
                )

        # Reclaim space after table drops.
        conn.execute("VACUUM")

        return {
            "kept": kept,
            "dropped": to_drop,
            "output": str(output_path),
        }
    finally:
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prune a GeoPackage to keep only selected layers/tables."
    )
    parser.add_argument("--input", required=True, type=Path, help="Path to input .gpkg")
    parser.add_argument("--output", required=False, type=Path, default=None, help="Path to output .gpkg")
    parser.add_argument(
        "--keep",
        action="append",
        required=True,
        help="Table name to keep. Repeat --keep for multiple tables.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be removed without writing output.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    input_path: Path = args.input
    output_path: Path = args.output or input_path.with_name(input_path.stem + "_pruned.gpkg")

    result = prune_gpkg(
        input_path=input_path,
        output_path=output_path,
        keep_tables=args.keep,
        dry_run=bool(args.dry_run),
    )

    print("Prune summary")
    print("Kept tables:", ", ".join(result["kept"]) if result["kept"] else "-")
    print("Dropped tables:", ", ".join(result["dropped"]) if result["dropped"] else "-")
    if result["output"]:
        print("Output:", result["output"])
    else:
        print("Output: (dry-run, no file written)")


if __name__ == "__main__":
    main()
