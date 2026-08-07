"""Loading jobs and job-type profiles from disk into domain models.

Kept separate from risk_engine.py on purpose: parsing concerns (CSV
quoting, JSON schema, malformed rows) have nothing to do with risk logic,
and mixing them makes both harder to test in isolation.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

from weather_triage.models import Coordinates, Crew, Job, JobTypeProfile


class JobDataError(ValueError):
    """Raised when input data is present but doesn't parse into a valid Job."""


def load_jobs_from_csv(path: Path) -> list[Job]:
    jobs: list[Job] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for line_number, row in enumerate(reader, start=2):  # header is line 1
            try:
                jobs.append(_row_to_job(row))
            except (KeyError, ValueError) as exc:
                raise JobDataError(f"{path.name}, line {line_number}: {exc}") from exc
    return jobs


def _row_to_job(row: dict[str, str]) -> Job:
    crew_id = row.get("crew_id") or None
    return Job(
        job_id=row["job_id"],
        scheduled_date=datetime.strptime(row["date"], "%Y-%m-%d").date(),
        scheduled_time=datetime.strptime(row["time"], "%H:%M").time(),
        location=Coordinates(
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
        ),
        address=row["address"],
        job_type=row["job_type"],
        duration_hours=float(row["duration_hours"]),
        crew_id=crew_id,
    )


def load_crews(path: Path) -> list[Crew]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    crews = []
    for entry in raw:
        crews.append(
            Crew(
                crew_id=entry["crew_id"],
                name=entry["name"],
                home_base=Coordinates(latitude=entry["latitude"], longitude=entry["longitude"]),
                skills=entry.get("skills", []),
            )
        )
    return crews


def load_job_type_profiles(path: Path) -> dict[str, JobTypeProfile]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    profiles: dict[str, JobTypeProfile] = {}
    for name, thresholds in raw.items():
        profiles[name] = JobTypeProfile(
            name=name,
            max_wind_speed_ms=thresholds.get("max_wind_ms"),
            max_precipitation_mm=thresholds.get("max_rain_mm"),
            min_temperature_c=thresholds.get("min_temp_c"),
            max_temperature_c=thresholds.get("max_temp_c"),
        )
    return profiles
