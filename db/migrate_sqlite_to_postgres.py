"""
Copy lawata.db (SQLite) into PostgreSQL/PostGIS (e.g. Neon).

Usage:
    pip install "psycopg[binary]"
    export DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"
    python migrate_sqlite_to_postgres.py lawata.db            # create schema + load
    python migrate_sqlite_to_postgres.py lawata.db --reset    # drop Lawata tables first, then reload

Keeps every primary key, runs in one transaction (all or nothing),
resets identity sequences, then checks row counts against the source.
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

import psycopg

TABLES = [  # parents before children
    "aoi",
    "satellite_tile",
    "platform",
    "scene",
    "acquisition",
    "acquisition_scene",
    "raster_product",
    "raster_asset",
    "weather_source",
    "rain_station",
    "rainfall_daily",
    "place",
    "detection_run",
    "plume_kind",
    "plume_event",
    "event_review",
    "watch_zone",
    "zone_observation",
    "source_document",
    "incident_type",
    "incident",
]
IDENTITY = {
    "aoi": "aoi_id",
    "acquisition": "acquisition_id",
    "raster_asset": "asset_id",
    "rain_station": "station_id",
    "place": "place_id",
    "detection_run": "run_id",
    "plume_event": "event_id",
    "event_review": "review_id",
    "watch_zone": "zone_id",
    "source_document": "doc_id",
    "incident": "incident_id",
}
VIEWS = ["v_dry_weather_plumes", "v_plume_event_context", "v_event_latest_review"]


def env(lon0, lat0, lon1, lat1):
    return f"SRID=4326;POLYGON(({lon0} {lat0},{lon1} {lat0},{lon1} {lat1},{lon0} {lat1},{lon0} {lat0}))"


def pt(lat, lon):
    return f"SRID=4326;POINT({lon} {lat})"


def rows(src, table):
    cur = src.execute(f"SELECT * FROM {table}")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur]


# Per-table mapping from SQLite row -> (postgres columns, values)
def convert(table, r):
    if table == "aoi":
        return dict(
            aoi_id=r["aoi_id"],
            code=r["code"],
            name=r["name"],
            geom=env(r["min_lon"], r["min_lat"], r["max_lon"], r["max_lat"]),
            grid_crs=r["grid_crs"],
            grid_res_m=r["grid_res_m"],
        )
    if table == "satellite_tile":
        return dict(
            tile_code=r["tile_code"],
            footprint=env(r["min_lon"], r["min_lat"], r["max_lon"], r["max_lat"])
            if r["min_lon"] is not None
            else None,
        )
    if table == "acquisition":
        return {**r, "is_usable": bool(r["is_usable"])}
    if table == "raster_product":
        return {**r, "bands": r["bands"].split(",") if r["bands"] else None}
    if table == "rain_station":
        return dict(
            station_id=r["station_id"], source_code=r["source_code"], geom=pt(r["lat"], r["lon"])
        )
    if table == "place":
        return dict(
            place_id=r["place_id"],
            name=r["name"],
            province=r["province"],
            geom=pt(r["lat"], r["lon"]),
            rain_station_id=r["rain_station_id"],
            notes=r["notes"],
        )
    if table == "detection_run":
        return dict(
            run_id=r["run_id"],
            aoi_id=r["aoi_id"],
            method=r["method"],
            code_version=r["code_version"],
            params=json.loads(r["params_json"]),
            started_at=r["started_at"],
            notes=r["notes"],
        )
    if table == "plume_event":
        return dict(
            event_id=r["event_id"],
            run_id=r["run_id"],
            acquisition_id=r["acquisition_id"],
            place_id=r["place_id"],
            kind_code=r["kind_code"],
            area_ha=r["area_ha"],
            change_score=r["change_score"],
            roughness_ratio=r["roughness_ratio"],
            entry_geom=pt(r["entry_lat"], r["entry_lon"]),
            centroid_geom=pt(r["centroid_lat"], r["centroid_lon"]),
            bbox_px=json.loads(r["bbox_px_json"]) if r["bbox_px_json"] else None,
        )
    if table == "watch_zone":
        return dict(
            zone_id=r["zone_id"],
            aoi_id=r["aoi_id"],
            place_id=r["place_id"],
            name=r["name"],
            geom=env(r["min_lon"], r["min_lat"], r["max_lon"], r["max_lat"]),
        )
    return dict(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sqlite_path")
    ap.add_argument(
        "--reset", action="store_true", help="drop existing Lawata tables and views first"
    )
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL"))
    a = ap.parse_args()
    if not a.dsn:
        sys.exit("Set DATABASE_URL or pass --dsn")

    src = sqlite3.connect(a.sqlite_path)
    schema = (Path(__file__).parent / "schema.sql").read_text()

    with psycopg.connect(a.dsn) as pg:
        with pg.transaction():
            cur = pg.cursor()
            exists = cur.execute("SELECT to_regclass('public.plume_event') IS NOT NULL").fetchone()[
                0
            ]
            if exists and not a.reset:
                sys.exit("Lawata tables already exist. Re-run with --reset to replace them.")
            if a.reset:
                for v in VIEWS:
                    cur.execute(f"DROP VIEW IF EXISTS {v} CASCADE")
                for t in reversed(TABLES):
                    cur.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
            cur.execute(schema.replace("BEGIN;", "").replace("COMMIT;", ""))

            for t in TABLES:
                data = [convert(t, r) for r in rows(src, t)]
                if not data:
                    continue
                cols = list(data[0])
                if t == "rainfall_daily":  # big table: COPY
                    with cur.copy(f"COPY {t} ({','.join(cols)}) FROM STDIN") as cp:
                        for d in data:
                            cp.write_row([d[c] for c in cols])
                else:
                    jsonb = {c for c in cols if c in ("params", "bbox_px")}
                    ph = ",".join("%s::jsonb" if c in jsonb else "%s" for c in cols)
                    vals = [
                        [
                            json.dumps(d[c]) if c in jsonb and d[c] is not None else d[c]
                            for c in cols
                        ]
                        for d in data
                    ]
                    cur.executemany(f"INSERT INTO {t} ({','.join(cols)}) VALUES ({ph})", vals)
                print(f"{t:18s} {len(data):6d} rows")

            for t, k in IDENTITY.items():
                cur.execute(
                    f"SELECT setval(pg_get_serial_sequence('{t}','{k}'), COALESCE((SELECT MAX({k}) FROM {t}),0)+1, false)"
                )

            # verify
            bad = []
            for t in TABLES:
                n_src = src.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                n_pg = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                if n_src != n_pg:
                    bad.append((t, n_src, n_pg))
            if bad:
                raise RuntimeError(f"Row count mismatch: {bad}")
            n_dry_src = src.execute("SELECT COUNT(*) FROM v_dry_weather_plumes").fetchone()[0]
            n_dry_pg = cur.execute("SELECT COUNT(*) FROM v_dry_weather_plumes").fetchone()[0]
            if n_dry_src != n_dry_pg:
                raise RuntimeError(f"Dry-weather view differs: sqlite {n_dry_src} vs pg {n_dry_pg}")
            cur.execute("ANALYZE")
    print(f"OK: all row counts match; {n_dry_pg} dry-weather plumes.")


if __name__ == "__main__":
    main()
