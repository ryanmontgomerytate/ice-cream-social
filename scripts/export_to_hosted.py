#!/usr/bin/env python3
"""
Export local SQLite podcast data and optionally import it into hosted Postgres (Supabase).

Usage:
  python scripts/export_to_hosted.py --mode export
  python scripts/export_to_hosted.py --mode import
  python scripts/export_to_hosted.py --mode full
  python scripts/export_to_hosted.py --mode full --dry-run
  python scripts/export_to_hosted.py --tables episodes transcript_segments
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE_PATH = ROOT_DIR / "data" / "ice_cream_social.db"
DEFAULT_EXPORT_ROOT = ROOT_DIR / "exports"
DEFAULT_SHOW_SLUG = "ics"
DEFAULT_SHOW_NAME = "Matt and Mattingly's Ice Cream Social"
DEFAULT_SHOW_DESCRIPTION = "A comedy podcast hosted by Matt Donnelly and Paul Mattingly."
DEFAULT_SCHEMA_VERSION = "001"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_json_text(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if not isinstance(value, str):
        return value

    text = value.strip()
    if text == "":
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Keep malformed JSON payloads as JSON strings so import never crashes.
        return value


def to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "t", "yes", "y"}
    return bool(value)


def sanitize_row_values(row: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, bytes):
            out[key] = value.decode("utf-8", errors="replace")
        else:
            out[key] = value
    return out


@dataclass(frozen=True)
class TableConfig:
    name: str
    select_sql: str
    transform: Callable[[Dict[str, Any]], Dict[str, Any]]
    conflict_cols: List[str]
    import_batch_size: int = 500


def _identity(row: Dict[str, Any]) -> Dict[str, Any]:
    return row


TABLE_ORDER = [
    "shows",
    "episodes",
    "speakers",
    "episode_speakers",
    "characters",
    "character_appearances",
    "chapter_types",
    "episode_chapters",
    "audio_drops",
    "audio_drop_instances",
    "wiki_lore",
    "wiki_lore_mentions",
    "wiki_episode_meta",
    "transcript_segments",
]


def build_table_configs() -> Dict[str, TableConfig]:
    return {
        "shows": TableConfig(
            name="shows",
            select_sql="""
                SELECT
                    'ics' AS slug,
                    ? AS name,
                    ? AS description
            """,
            transform=lambda row: {
                "slug": row["slug"],
                "name": row["name"],
                "description": row["description"],
            },
            conflict_cols=["slug"],
            import_batch_size=1,
        ),
        "episodes": TableConfig(
            name="episodes",
            select_sql="""
                SELECT
                    id,
                    episode_number,
                    title,
                    description,
                    audio_url,
                    duration,
                    published_date,
                    category,
                    category_number,
                    sub_series,
                    canonical_id,
                    feed_source,
                    num_speakers,
                    has_diarization,
                    metadata_json
                FROM episodes
                ORDER BY id
            """,
            transform=lambda row: {
                "id": row["id"],
                "episode_number": row["episode_number"],
                "title": row["title"],
                "description": row["description"],
                "audio_url": row["audio_url"],
                "duration": row["duration"],
                "published_date": row["published_date"],
                "category": row["category"] or "episode",
                "category_number": row["category_number"],
                "sub_series": row["sub_series"],
                "canonical_id": row["canonical_id"],
                "feed_source": row["feed_source"] or "patreon",
                "num_speakers": row["num_speakers"],
                "has_diarization": to_bool(row["has_diarization"]),
                "metadata_json": parse_json_text(row["metadata_json"]),
                "visibility": "public",
            },
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "speakers": TableConfig(
            name="speakers",
            select_sql="""
                SELECT
                    id,
                    name,
                    short_name,
                    description,
                    is_host,
                    image_url,
                    created_at
                FROM speakers
                ORDER BY id
            """,
            transform=lambda row: {
                "id": row["id"],
                "name": row["name"],
                "short_name": row["short_name"],
                "description": row["description"],
                "is_host": to_bool(row["is_host"]),
                "image_url": row["image_url"],
                "created_at": row["created_at"],
            },
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "episode_speakers": TableConfig(
            name="episode_speakers",
            select_sql="""
                SELECT
                    id,
                    episode_id,
                    diarization_label,
                    speaker_id,
                    speaking_time_seconds,
                    segment_count,
                    confidence,
                    source
                FROM episode_speakers
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "characters": TableConfig(
            name="characters",
            select_sql="""
                SELECT
                    id,
                    name,
                    short_name,
                    description,
                    catchphrase,
                    first_episode_id,
                    speaker_id,
                    image_url,
                    created_at
                FROM characters
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "character_appearances": TableConfig(
            name="character_appearances",
            select_sql="""
                SELECT
                    id,
                    character_id,
                    episode_id,
                    start_time,
                    end_time,
                    segment_idx,
                    notes,
                    created_at
                FROM character_appearances
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "chapter_types": TableConfig(
            name="chapter_types",
            select_sql="""
                SELECT
                    id,
                    name,
                    description,
                    color,
                    icon,
                    sort_order,
                    created_at
                FROM chapter_types
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=200,
        ),
        "episode_chapters": TableConfig(
            name="episode_chapters",
            select_sql="""
                SELECT
                    id,
                    episode_id,
                    chapter_type_id,
                    title,
                    start_time,
                    end_time,
                    start_segment_idx,
                    end_segment_idx,
                    notes,
                    created_at
                FROM episode_chapters
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "audio_drops": TableConfig(
            name="audio_drops",
            select_sql="""
                SELECT
                    id,
                    name,
                    transcript_text,
                    description,
                    category,
                    created_at
                FROM audio_drops
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=200,
        ),
        "audio_drop_instances": TableConfig(
            name="audio_drop_instances",
            select_sql="""
                SELECT
                    id,
                    audio_drop_id,
                    episode_id,
                    segment_idx,
                    start_time,
                    end_time,
                    notes,
                    created_at
                FROM audio_drop_instances
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "wiki_lore": TableConfig(
            name="wiki_lore",
            select_sql="""
                SELECT
                    id,
                    name,
                    category,
                    description,
                    wiki_url,
                    wiki_page_id,
                    first_episode_id,
                    aliases,
                    last_synced,
                    is_wiki_sourced
                FROM wiki_lore
                ORDER BY id
            """,
            transform=lambda row: {**row, "is_wiki_sourced": to_bool(row["is_wiki_sourced"])},
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "wiki_lore_mentions": TableConfig(
            name="wiki_lore_mentions",
            select_sql="""
                SELECT
                    id,
                    lore_id,
                    episode_id,
                    segment_idx,
                    start_time,
                    end_time,
                    context_snippet,
                    source,
                    confidence
                FROM wiki_lore_mentions
                ORDER BY id
            """,
            transform=_identity,
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "wiki_episode_meta": TableConfig(
            name="wiki_episode_meta",
            select_sql="""
                SELECT
                    id,
                    episode_id,
                    wiki_page_id,
                    wiki_url,
                    summary,
                    recording_location,
                    air_date,
                    topics_json,
                    guests_json,
                    bits_json,
                    scoopmail_json,
                    jock_vs_nerd,
                    last_synced
                FROM wiki_episode_meta
                ORDER BY id
            """,
            transform=lambda row: {
                **row,
                "topics_json": parse_json_text(row["topics_json"]),
                "guests_json": parse_json_text(row["guests_json"]),
                "bits_json": parse_json_text(row["bits_json"]),
                "scoopmail_json": parse_json_text(row["scoopmail_json"]),
            },
            conflict_cols=["id"],
            import_batch_size=500,
        ),
        "transcript_segments": TableConfig(
            name="transcript_segments",
            select_sql="""
                SELECT
                    id,
                    episode_id,
                    segment_idx,
                    speaker,
                    text,
                    start_time,
                    end_time,
                    is_performance_bit
                FROM transcript_segments
                ORDER BY id
            """,
            transform=lambda row: {**row, "is_performance_bit": to_bool(row["is_performance_bit"])},
            conflict_cols=["id"],
            import_batch_size=1000,
        ),
    }


def iter_sqlite_rows(
    conn: sqlite3.Connection,
    table_config: TableConfig,
    fetch_size: int = 1000,
) -> Iterator[Dict[str, Any]]:
    cur = conn.cursor()
    if table_config.name == "shows":
        cur.execute(
            table_config.select_sql,
            [DEFAULT_SHOW_NAME, DEFAULT_SHOW_DESCRIPTION],
        )
    else:
        cur.execute(table_config.select_sql)
    while True:
        batch = cur.fetchmany(fetch_size)
        if not batch:
            break
        col_names = [c[0] for c in cur.description]
        for row_tuple in batch:
            raw = dict(zip(col_names, row_tuple))
            raw = sanitize_row_values(raw)
            yield table_config.transform(raw)


def count_sqlite_rows(conn: sqlite3.Connection, table_name: str) -> int:
    if table_name == "shows":
        return 1
    cur = conn.cursor()
    cur.execute(f"SELECT COUNT(*) FROM {table_name}")
    val = cur.fetchone()
    return int(val[0]) if val else 0


def ensure_postgres_driver():
    try:
        import psycopg2  # type: ignore
        from psycopg2 import sql  # type: ignore
        from psycopg2.extras import Json, execute_values  # type: ignore

        return psycopg2, sql, Json, execute_values
    except ImportError as exc:
        raise SystemExit(
            "Missing PostgreSQL driver. Install one of:\n"
            "  pip install psycopg2-binary\n"
            "or\n"
            "  pip install psycopg[binary]"
        ) from exc


def chunked(rows: Iterable[Dict[str, Any]], size: int) -> Iterator[List[Dict[str, Any]]]:
    chunk: List[Dict[str, Any]] = []
    for row in rows:
        chunk.append(row)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def insert_import_batch(pg_cur, schema_version: str) -> Optional[int]:
    try:
        pg_cur.execute(
            """
            INSERT INTO import_batches (schema_version, imported_at, status)
            VALUES (%s, now(), 'in_progress')
            RETURNING id
            """,
            (schema_version,),
        )
        row = pg_cur.fetchone()
        return int(row[0]) if row else None
    except Exception:
        return None


def update_import_batch(
    pg_cur,
    batch_id: Optional[int],
    *,
    episode_count: int,
    segment_count: int,
    character_count: int,
    status: str,
    error_text: Optional[str] = None,
) -> None:
    if batch_id is None:
        return
    pg_cur.execute(
        """
        UPDATE import_batches
        SET imported_at = now(),
            episode_count = %s,
            segment_count = %s,
            character_count = %s,
            status = %s,
            error = %s
        WHERE id = %s
        """,
        (episode_count, segment_count, character_count, status, error_text, batch_id),
    )


def upsert_rows(
    *,
    pg_cur,
    sql_mod,
    execute_values,
    json_adapter,
    table_name: str,
    rows: List[Dict[str, Any]],
    conflict_cols: List[str],
) -> int:
    if not rows:
        return 0

    columns = list(rows[0].keys())
    value_tuples = []
    for row in rows:
        values = []
        for col in columns:
            value = row[col]
            if isinstance(value, (dict, list)):
                values.append(json_adapter(value))
            elif col.endswith("_json") and value is not None:
                values.append(json_adapter(value))
            else:
                values.append(value)
        value_tuples.append(tuple(values))

    update_cols = [c for c in columns if c not in conflict_cols]
    insert_cols_sql = sql_mod.SQL(", ").join(sql_mod.Identifier(c) for c in columns)
    conflict_cols_sql = sql_mod.SQL(", ").join(sql_mod.Identifier(c) for c in conflict_cols)
    if update_cols:
        updates_sql = sql_mod.SQL(", ").join(
            sql_mod.SQL("{} = EXCLUDED.{}").format(sql_mod.Identifier(c), sql_mod.Identifier(c))
            for c in update_cols
        )
        query = sql_mod.SQL(
            """
            INSERT INTO {} ({})
            VALUES %s
            ON CONFLICT ({})
            DO UPDATE SET {}
            """
        ).format(
            sql_mod.Identifier(table_name),
            insert_cols_sql,
            conflict_cols_sql,
            updates_sql,
        )
    else:
        query = sql_mod.SQL(
            """
            INSERT INTO {} ({})
            VALUES %s
            ON CONFLICT ({})
            DO NOTHING
            """
        ).format(
            sql_mod.Identifier(table_name),
            insert_cols_sql,
            conflict_cols_sql,
        )

    execute_values(pg_cur, query.as_string(pg_cur.connection), value_tuples, page_size=len(rows))
    return len(rows)


def export_tables(
    *,
    sqlite_conn: sqlite3.Connection,
    sqlite_path: Path,
    table_names: List[str],
    table_configs: Dict[str, TableConfig],
    export_root: Path,
    dry_run: bool,
) -> Dict[str, Any]:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = export_root / timestamp
    table_counts: Dict[str, int] = {}

    if not dry_run:
        run_dir.mkdir(parents=True, exist_ok=True)

    for table_name in table_names:
        cfg = table_configs[table_name]
        if dry_run:
            table_counts[table_name] = count_sqlite_rows(sqlite_conn, table_name)
            continue

        out_path = run_dir / f"{table_name}.jsonl"
        count = 0
        with out_path.open("w", encoding="utf-8") as fh:
            for row in iter_sqlite_rows(sqlite_conn, cfg):
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                count += 1
        table_counts[table_name] = count

    manifest = {
        "run_id": timestamp,
        "generated_at": utc_now_iso(),
        "sqlite_path": str(sqlite_path),
        "tables": table_names,
        "counts": table_counts,
        "dry_run": dry_run,
        "schema_version": DEFAULT_SCHEMA_VERSION,
    }

    if not dry_run:
        manifest_path = run_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        update_import_log(export_root / "import_log.json", manifest)

    return manifest


def update_import_log(log_path: Path, run_manifest: Dict[str, Any]) -> None:
    existing: Dict[str, Any] = {"runs": []}
    if log_path.exists():
        try:
            existing = json.loads(log_path.read_text(encoding="utf-8"))
            if not isinstance(existing, dict):
                existing = {"runs": []}
        except json.JSONDecodeError:
            existing = {"runs": []}

    runs = existing.get("runs")
    if not isinstance(runs, list):
        runs = []
    runs.append(run_manifest)

    existing["runs"] = runs[-50:]
    existing["last_run"] = run_manifest
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")


def import_tables(
    *,
    sqlite_conn: sqlite3.Connection,
    table_names: List[str],
    table_configs: Dict[str, TableConfig],
    database_url: str,
    dry_run: bool,
) -> Dict[str, int]:
    if dry_run:
        return {table: count_sqlite_rows(sqlite_conn, table) for table in table_names}

    psycopg2, sql_mod, json_adapter, execute_values = ensure_postgres_driver()
    imported_counts: Dict[str, int] = {table: 0 for table in table_names}

    with psycopg2.connect(database_url) as pg_conn:
        with pg_conn.cursor() as pg_cur:
            batch_id = insert_import_batch(pg_cur, DEFAULT_SCHEMA_VERSION)
            show_id: Optional[int] = None
            if "shows" in table_names:
                shows_rows = list(iter_sqlite_rows(sqlite_conn, table_configs["shows"]))
                imported_counts["shows"] += upsert_rows(
                    pg_cur=pg_cur,
                    sql_mod=sql_mod,
                    execute_values=execute_values,
                    json_adapter=json_adapter,
                    table_name="shows",
                    rows=shows_rows,
                    conflict_cols=table_configs["shows"].conflict_cols,
                )
            pg_cur.execute("SELECT id FROM shows WHERE slug = %s LIMIT 1", (DEFAULT_SHOW_SLUG,))
            show_row = pg_cur.fetchone()
            if show_row:
                show_id = int(show_row[0])
            else:
                pg_cur.execute(
                    """
                    INSERT INTO shows (slug, name, description)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
                    (DEFAULT_SHOW_SLUG, DEFAULT_SHOW_NAME, DEFAULT_SHOW_DESCRIPTION),
                )
                show_id = int(pg_cur.fetchone()[0])

            try:
                for table_name in table_names:
                    if table_name == "shows":
                        continue
                    cfg = table_configs[table_name]
                    rows_iter = iter_sqlite_rows(sqlite_conn, cfg)
                    for chunk in chunked(rows_iter, cfg.import_batch_size):
                        if table_name == "episodes":
                            for row in chunk:
                                row["show_id"] = show_id
                                row["imported_at"] = utc_now_iso()
                                row["import_batch_id"] = batch_id
                        imported_counts[table_name] += upsert_rows(
                            pg_cur=pg_cur,
                            sql_mod=sql_mod,
                            execute_values=execute_values,
                            json_adapter=json_adapter,
                            table_name=table_name,
                            rows=chunk,
                            conflict_cols=cfg.conflict_cols,
                        )

                update_import_batch(
                    pg_cur,
                    batch_id,
                    episode_count=imported_counts.get("episodes", 0),
                    segment_count=imported_counts.get("transcript_segments", 0),
                    character_count=imported_counts.get("characters", 0),
                    status="complete",
                    error_text=None,
                )
            except Exception as exc:
                update_import_batch(
                    pg_cur,
                    batch_id,
                    episode_count=imported_counts.get("episodes", 0),
                    segment_count=imported_counts.get("transcript_segments", 0),
                    character_count=imported_counts.get("characters", 0),
                    status="failed",
                    error_text=str(exc)[:2000],
                )
                raise

    return imported_counts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export local SQLite data to hosted Postgres.")
    parser.add_argument(
        "--mode",
        choices=["export", "import", "full"],
        default="full",
        help="export: JSON only, import: DB upsert only, full: both",
    )
    parser.add_argument(
        "--tables",
        nargs="+",
        default=None,
        help="Optional subset of tables to process.",
    )
    parser.add_argument(
        "--sqlite-path",
        default=str(DEFAULT_SQLITE_PATH),
        help="Path to local SQLite DB.",
    )
    parser.add_argument(
        "--export-root",
        default=str(DEFAULT_EXPORT_ROOT),
        help="Directory for JSONL exports and import logs.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print counts and actions only, do not write exports or import data.",
    )
    return parser.parse_args()


def resolve_tables(requested_tables: Optional[List[str]], table_configs: Dict[str, TableConfig]) -> List[str]:
    if not requested_tables:
        return list(TABLE_ORDER)

    requested = [t.strip() for t in requested_tables if t.strip()]
    unknown = sorted(set(requested) - set(table_configs.keys()))
    if unknown:
        raise SystemExit(
            "Unknown table(s): "
            + ", ".join(unknown)
            + "\nAvailable: "
            + ", ".join(TABLE_ORDER)
        )

    # Keep FK-safe order while honoring user subset.
    requested_set = set(requested)
    return [t for t in TABLE_ORDER if t in requested_set]


def main() -> None:
    args = parse_args()
    table_configs = build_table_configs()
    table_names = resolve_tables(args.tables, table_configs)
    sqlite_path = Path(args.sqlite_path).expanduser().resolve()
    export_root = Path(args.export_root).expanduser().resolve()

    if not sqlite_path.exists():
        raise SystemExit(f"SQLite DB not found: {sqlite_path}")

    needs_import = args.mode in {"import", "full"}
    database_url = os.getenv("DATABASE_URL", "").strip()
    if needs_import and not args.dry_run and not database_url:
        raise SystemExit("DATABASE_URL is required for import/full mode.")

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row
    try:
        print(f"[info] mode={args.mode} dry_run={args.dry_run}")
        print(f"[info] sqlite={sqlite_path}")
        print(f"[info] tables={', '.join(table_names)}")

        export_manifest: Optional[Dict[str, Any]] = None
        if args.mode in {"export", "full"}:
            export_manifest = export_tables(
                sqlite_conn=sqlite_conn,
                sqlite_path=sqlite_path,
                table_names=table_names,
                table_configs=table_configs,
                export_root=export_root,
                dry_run=args.dry_run,
            )
            print("[export] counts:")
            for table_name in table_names:
                print(f"  - {table_name}: {export_manifest['counts'].get(table_name, 0)}")

        if args.mode in {"import", "full"}:
            import_counts = import_tables(
                sqlite_conn=sqlite_conn,
                table_names=table_names,
                table_configs=table_configs,
                database_url=database_url,
                dry_run=args.dry_run,
            )
            print("[import] counts:")
            for table_name in table_names:
                print(f"  - {table_name}: {import_counts.get(table_name, 0)}")

        print("[done] export/import pipeline finished.")
    finally:
        sqlite_conn.close()


if __name__ == "__main__":
    main()
