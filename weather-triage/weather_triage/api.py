"""HTTP API surface over the risk engine and the persistent job store.

This file intentionally contains little business logic of its own — risk
scoring stays in risk_engine.py (tested independently), persistence stays
in db.py (tested independently). This layer's job is translation: HTTP in,
domain calls out, JSON back.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from weather_triage.db import JobStore
from weather_triage.job_repository import load_crews, load_job_type_profiles, load_jobs_from_csv
from weather_triage.models import Coordinates, DailyForecast, Job
from weather_triage.risk_engine import RiskEngine
from weather_triage.weather_client import OpenMeteoClient, WeatherClientError

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
DB_PATH = DATA_DIR / "weather_triage.db"

app = FastAPI(title="Weather Triage API", version="0.2.0")

# Demo-only: open CORS so the frontend can run on a different port locally.
# A production deployment would restrict this to the actual frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_store = JobStore(DB_PATH)
_crews = load_crews(DATA_DIR / "crews.json")
_profiles = load_job_type_profiles(CONFIG_DIR / "job_type_profiles.json")
_engine = RiskEngine(job_profiles=_profiles)
_weather_client = OpenMeteoClient()

# First run only: the database starts empty, so seed it once from the
# original synthetic CSV. Every run after this reads from the database —
# the CSV is a one-time bootstrap, not the source of truth anymore.
if _store.is_empty():
    _store.seed_from(load_jobs_from_csv(DATA_DIR / "synthetic_jobs.csv"))

# Forecast cache keyed by rounded coordinates, so many jobs clustered in a
# handful of cities cost a handful of API calls, not one per job. Rounding
# to 2 decimals (~1km) is coarse enough to be cache-friendly, fine enough
# not to blur real weather differences between job sites.
_forecast_cache: dict[tuple[float, float], dict[date, DailyForecast]] = {}


def _forecast_for(lat: float, lng: float) -> dict[date, DailyForecast]:
    key = (round(lat, 2), round(lng, 2))
    if key not in _forecast_cache:
        try:
            _forecast_cache[key] = _weather_client.get_daily_forecast(Coordinates(lat, lng))
        except WeatherClientError:
            _forecast_cache[key] = {}
    return _forecast_cache[key]


class CrewOut(BaseModel):
    crew_id: str
    name: str
    latitude: float
    longitude: float
    skills: list[str]


class JobOut(BaseModel):
    job_id: str
    date: str
    time: str
    latitude: float
    longitude: float
    address: str
    job_type: str
    duration_hours: float
    crew_id: str | None
    risk_level: str
    reasons: list[str]
    suggested_reschedule_date: str | None


class RescheduleRequest(BaseModel):
    new_date: date


class NewJobRequest(BaseModel):
    job_id: str
    date: date
    time: str  # "HH:MM"
    latitude: float
    longitude: float
    address: str
    job_type: str
    duration_hours: float
    crew_id: str | None = None


class SnapshotOut(BaseModel):
    snapshot_date: str
    risk_level: str
    reasons: list[str]
    suggested_reschedule_date: str | None
    captured_at: str


@app.get("/api/crews", response_model=list[CrewOut])
def list_crews() -> list[CrewOut]:
    return [
        CrewOut(
            crew_id=c.crew_id, name=c.name,
            latitude=c.home_base.latitude, longitude=c.home_base.longitude,
            skills=c.skills,
        )
        for c in _crews
    ]


@app.get("/api/jobs", response_model=list[JobOut])
def list_jobs() -> list[JobOut]:
    """Assess every stored job and record today's snapshot for each.

    The snapshot write is what builds up history over time: every day
    someone opens the dashboard, that day's assessment is captured. Calling
    this repeatedly on the same day updates that day's row rather than
    piling up duplicates (see JobStore.record_snapshot).
    """
    today = date.today()
    results = []
    for job in _store.list_jobs():
        forecasts = _forecast_for(job.location.latitude, job.location.longitude)
        assessment = _engine.assess(job, forecasts)
        _store.record_snapshot(
            job_id=job.job_id,
            snapshot_date=today,
            risk_level=assessment.risk_level.value,
            reasons=assessment.reasons,
            suggested_reschedule_date=assessment.suggested_reschedule_date,
        )
        results.append(_to_job_out(job, assessment))
    return results


@app.post("/api/jobs", response_model=JobOut, status_code=201)
def create_job(body: NewJobRequest) -> JobOut:
    if _store.get_job(body.job_id) is not None:
        raise HTTPException(status_code=409, detail=f"job {body.job_id} already exists")
    if body.job_type not in _profiles:
        raise HTTPException(
            status_code=422,
            detail=f"unknown job_type '{body.job_type}'; known types: {sorted(_profiles)}",
        )

    job = Job(
        job_id=body.job_id,
        scheduled_date=body.date,
        scheduled_time=datetime.strptime(body.time, "%H:%M").time(),
        location=Coordinates(latitude=body.latitude, longitude=body.longitude),
        address=body.address,
        job_type=body.job_type,
        duration_hours=body.duration_hours,
        crew_id=body.crew_id,
    )
    _store.create_job(job)

    forecasts = _forecast_for(job.location.latitude, job.location.longitude)
    assessment = _engine.assess(job, forecasts)
    return _to_job_out(job, assessment)


@app.delete("/api/jobs/{job_id}", status_code=204)
def delete_job(job_id: str) -> None:
    if _store.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail=f"job {job_id} not found")
    _store.delete_job(job_id)


@app.post("/api/jobs/{job_id}/reschedule", response_model=JobOut)
def reschedule_job(job_id: str, body: RescheduleRequest) -> JobOut:
    """Move a job to a new date and persist it — this is a real, saved
    change, not a preview. The updated assessment is recorded as today's
    snapshot immediately, so the history reflects the decision right away
    rather than waiting for the next /api/jobs poll.
    """
    job = _store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"job {job_id} not found")

    _store.update_job_date(job_id, body.new_date)
    moved_job = replace(job, scheduled_date=body.new_date)

    forecasts = _forecast_for(moved_job.location.latitude, moved_job.location.longitude)
    assessment = _engine.assess(moved_job, forecasts)
    _store.record_snapshot(
        job_id=job_id,
        snapshot_date=date.today(),
        risk_level=assessment.risk_level.value,
        reasons=assessment.reasons,
        suggested_reschedule_date=assessment.suggested_reschedule_date,
    )
    return _to_job_out(moved_job, assessment)


@app.get("/api/jobs/{job_id}/history", response_model=list[SnapshotOut])
def job_history(job_id: str) -> list[SnapshotOut]:
    if _store.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail=f"job {job_id} not found")
    return [SnapshotOut(**snap) for snap in _store.get_history(job_id)]


def _to_job_out(job: Job, assessment) -> JobOut:
    return JobOut(
        job_id=job.job_id,
        date=job.scheduled_date.isoformat(),
        time=job.scheduled_time.strftime("%H:%M"),
        latitude=job.location.latitude,
        longitude=job.location.longitude,
        address=job.address,
        job_type=job.job_type,
        duration_hours=job.duration_hours,
        crew_id=job.crew_id,
        risk_level=assessment.risk_level.value,
        reasons=assessment.reasons,
        suggested_reschedule_date=(
            assessment.suggested_reschedule_date.isoformat()
            if assessment.suggested_reschedule_date else None
        ),
    )


@app.get("/api/health")
def health() -> dict:
    jobs = _store.list_jobs()
    return {"status": "ok", "jobs_loaded": len(jobs), "crews_loaded": len(_crews)}
