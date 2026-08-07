"""Persistent storage for jobs and their daily risk-assessment history.

Uses SQLite via the standard library — no extra service to install or run,
which matters for a tool meant to be easy to trial. A team outgrowing
SQLite's single-writer model would swap this module for a Postgres-backed
one; nothing above this layer (the API, the risk engine) would need to
change, since both speak the same Job/RiskAssessment types either way.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from weather_triage.models import Coordinates, Job

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT NOT NULL,
    job_type TEXT NOT NULL,
    duration_hours REAL NOT NULL,
    crew_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    reasons TEXT NOT NULL,
    suggested_reschedule_date TEXT,
    captured_at TEXT NOT NULL,
    UNIQUE(job_id, snapshot_date)
);
"""


class JobStore:
    """Owns the SQLite connection and all reads/writes to it.

    One instance per process is expected (held by the FastAPI app). SQLite
    handles concurrent readers fine; concurrent writers would serialize —
    acceptable at this scale, worth revisiting only if this became a
    multi-dispatcher production tool.
    """

    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def is_empty(self) -> bool:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM jobs").fetchone()
        return row["n"] == 0

    def seed_from(self, jobs: list[Job]) -> None:
        """One-time import, used to migrate the original synthetic CSV data
        into the database on first run. No-ops on subsequent starts because
        `is_empty()` guards the call site.
        """
        now = datetime.now(timezone.utc).isoformat()
        for job in jobs:
            self._insert_job(job, created_at=now)
        self._conn.commit()

    def list_jobs(self) -> list[Job]:
        rows = self._conn.execute("SELECT * FROM jobs ORDER BY date, time").fetchall()
        return [_row_to_job(row) for row in rows]

    def get_job(self, job_id: str) -> Job | None:
        row = self._conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        return _row_to_job(row) if row else None

    def create_job(self, job: Job) -> None:
        self._insert_job(job, created_at=datetime.now(timezone.utc).isoformat())
        self._conn.commit()

    def update_job_date(self, job_id: str, new_date: date) -> None:
        self._conn.execute(
            "UPDATE jobs SET date = ? WHERE job_id = ?", (new_date.isoformat(), job_id)
        )
        self._conn.commit()

    def delete_job(self, job_id: str) -> None:
        self._conn.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
        self._conn.execute("DELETE FROM assessment_snapshots WHERE job_id = ?", (job_id,))
        self._conn.commit()

    def record_snapshot(
        self,
        job_id: str,
        snapshot_date: date,
        risk_level: str,
        reasons: list[str],
        suggested_reschedule_date: date | None,
    ) -> None:
        """Upserts today's assessment for this job. Calling this repeatedly
        on the same day overwrites that day's row rather than duplicating
        it — the history is "what did we last see each day", not every
        individual page load.
        """
        self._conn.execute(
            """
            INSERT INTO assessment_snapshots
                (job_id, snapshot_date, risk_level, reasons, suggested_reschedule_date, captured_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id, snapshot_date) DO UPDATE SET
                risk_level = excluded.risk_level,
                reasons = excluded.reasons,
                suggested_reschedule_date = excluded.suggested_reschedule_date,
                captured_at = excluded.captured_at
            """,
            (
                job_id,
                snapshot_date.isoformat(),
                risk_level,
                json.dumps(reasons),
                suggested_reschedule_date.isoformat() if suggested_reschedule_date else None,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        self._conn.commit()

    def get_history(self, job_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM assessment_snapshots WHERE job_id = ? ORDER BY snapshot_date DESC",
            (job_id,),
        ).fetchall()
        return [
            {
                "snapshot_date": row["snapshot_date"],
                "risk_level": row["risk_level"],
                "reasons": json.loads(row["reasons"]),
                "suggested_reschedule_date": row["suggested_reschedule_date"],
                "captured_at": row["captured_at"],
            }
            for row in rows
        ]

    def _insert_job(self, job: Job, created_at: str) -> None:
        self._conn.execute(
            """
            INSERT OR REPLACE INTO jobs
                (job_id, date, time, latitude, longitude, address, job_type, duration_hours, crew_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job.job_id,
                job.scheduled_date.isoformat(),
                job.scheduled_time.strftime("%H:%M"),
                job.location.latitude,
                job.location.longitude,
                job.address,
                job.job_type,
                job.duration_hours,
                job.crew_id,
                created_at,
            ),
        )


def _row_to_job(row: sqlite3.Row) -> Job:
    return Job(
        job_id=row["job_id"],
        scheduled_date=datetime.strptime(row["date"], "%Y-%m-%d").date(),
        scheduled_time=datetime.strptime(row["time"], "%H:%M").time(),
        location=Coordinates(latitude=row["latitude"], longitude=row["longitude"]),
        address=row["address"],
        job_type=row["job_type"],
        duration_hours=row["duration_hours"],
        crew_id=row["crew_id"],
    )
