"""Render evidence crops for plumes that have none yet.

For each plume, OpenCV re-reads the 10 m Sentinel-2 window at its shore entry point (no
model calls), uploads the overlay JPEG to `LAWATA_BUCKET` as `crops/plume-{id}.jpg` and
stores its URI on the plume. Safe to re-run: only plumes without a crop are processed.

    uv run python -m lawata.entrypoints.backfill_crops --dry-run
    uv run python -m lawata.entrypoints.backfill_crops --limit 50
"""

import argparse
import os
import sys

import boto3

from lawata.detection.adapters import S3CropStore
from lawata.detection.service import inspect_candidate
from lawata.imagery.adapters import StacCogReader
from lawata.imagery.domain import SceneNotFoundError
from lawata.shared.logging import get_logger
from lawata.sightings.adapters import NeonPlumeRepository

logger = get_logger(__name__)


def main(argv: list[str] | None = None) -> int:
    """Backfill crops; return a process exit code."""
    parser = argparse.ArgumentParser(description="Render evidence crops for plumes without one.")
    parser.add_argument("--limit", type=int, default=500, help="most plumes to process")
    parser.add_argument("--dry-run", action="store_true", help="only count plumes to process")
    args = parser.parse_args(argv)

    bucket = os.environ.get("LAWATA_BUCKET")
    if not bucket and not args.dry_run:
        logger.error("LAWATA_BUCKET is not set")
        return 1

    repository = NeonPlumeRepository()
    plumes = repository.plumes_without_crop(args.limit)
    logger.info("%d plumes without a crop", len(plumes))
    if args.dry_run or not bucket:
        return 0

    reader, store = StacCogReader(), S3CropStore(boto3.client("s3"), bucket)
    stored = 0
    for plume in plumes:
        try:
            crop = inspect_candidate(
                reader, store, f"plume-{plume.id}", plume.entry_lat, plume.entry_lon, plume.date
            )
        except SceneNotFoundError as error:
            logger.warning("plume %d skipped: %s", plume.id, error)
            continue
        repository.set_crop_uri(plume.id, crop.crop_uri)
        stored += 1
        logger.info("plume %d: %s", plume.id, crop.crop_uri)
    logger.info("done: %d of %d crops stored", stored, len(plumes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
