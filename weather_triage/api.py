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

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from weather_triage.db import JobStore
from weather_triage.job_repository import (
    job_price,
    load_crews,
    load_job_type_profiles,
    load_jobs_from_csv,
    load_pricing,
)
from weather_triage.models import Coordinates, DailyForecast, Job, RiskLevel
from weather_triage.risk_engine import RiskEngine
from weather_triage.route_planner import (
    Plan,
    PlannerSettings,
    evaluate_plan,
    propose_plan,
)
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
_hourly_rates, _planning_raw = load_pricing(CONFIG_DIR / "pricing.json")
_planner_settings = PlannerSettings(
    road_factor=_planning_raw.get("road_factor", 1.3),
    avg_speed_kmh=_planning_raw.get("avg_speed_kmh", 60),
    cost_per_km_sek=_planning_raw.get("cost_per_km_sek", 2.5),
    workday_start=datetime.strptime(_planning_raw.get("workday_start", "07:00"), "%H:%M").time(),
    max_distance_from_base_km=_planning_raw.get("max_distance_from_base_km", 120),
)
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
    daily_target_sek: float
    max_hours: float


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
    price_sek: float
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
    price_sek: float | None = None


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
            daily_target_sek=c.daily_target_sek, max_hours=c.max_hours,
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
        price_sek=body.price_sek,
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
        price_sek=job_price(job, _hourly_rates),
        risk_level=assessment.risk_level.value,
        reasons=assessment.reasons,
        suggested_reschedule_date=(
            assessment.suggested_reschedule_date.isoformat()
            if assessment.suggested_reschedule_date else None
        ),
    )


# --------------------------------------------------------------------------- #
# Route planning
# --------------------------------------------------------------------------- #

class StopOut(BaseModel):
    job_id: str
    address: str
    job_type: str
    latitude: float
    longitude: float
    duration_hours: float
    scheduled_time: str
    current_crew_id: str | None
    price_sek: float
    risk_level: str
    risk_reasons: list[str]
    arrival: str
    departure: str
    leg_km: float
    leg_minutes: float


class RouteOut(BaseModel):
    crew_id: str
    crew_name: str
    skills: list[str]
    home_latitude: float
    home_longitude: float
    stops: list[StopOut]
    total_km: float
    return_km: float
    drive_minutes: float
    work_hours: float
    total_hours: float
    max_hours: float
    finish_time: str | None
    revenue_sek: float
    target_sek: float
    target_pct: float
    drive_cost_sek: float
    warnings: list[str]
    maps_url: str | None


class UnassignedOut(BaseModel):
    job_id: str
    address: str
    job_type: str
    latitude: float
    longitude: float
    duration_hours: float
    scheduled_time: str
    current_crew_id: str | None
    price_sek: float
    risk_level: str
    risk_reasons: list[str]
    reason: str


class PlanOut(BaseModel):
    date: str
    routes: list[RouteOut]
    unassigned: list[UnassignedOut]
    total_revenue_sek: float
    total_target_sek: float
    total_km: float
    crews_on_target: int
    crews_working: int


class PlanEditRequest(BaseModel):
    date: date
    # crew_id -> ordered job_ids. Jobs left out become unassigned.
    assignments: dict[str, list[str]]
    # Crews whose stop order the dispatcher set by hand (don't re-optimise).
    keep_order_for: list[str] = []


def _planning_inputs(plan_date: date):
    jobs = [j for j in _store.list_jobs() if j.scheduled_date == plan_date]
    prices = {j.job_id: job_price(j, _hourly_rates) for j in jobs}
    risks: dict[str, RiskLevel] = {}
    reasons: dict[str, list[str]] = {}
    for job in jobs:
        assessment = _engine.assess(job, _forecast_for(job.location.latitude, job.location.longitude))
        risks[job.job_id] = assessment.risk_level
        reasons[job.job_id] = assessment.reasons
    return jobs, prices, risks, reasons


def _plan_out(plan: Plan, reasons: dict[str, list[str]]) -> PlanOut:
    def r1(x: float) -> float:
        return round(x, 1)

    routes = []
    for route in plan.routes:
        routes.append(RouteOut(
            crew_id=route.crew.crew_id,
            crew_name=route.crew.name,
            skills=route.crew.skills,
            home_latitude=route.crew.home_base.latitude,
            home_longitude=route.crew.home_base.longitude,
            stops=[
                StopOut(
                    job_id=s.job.job_id,
                    address=s.job.address,
                    job_type=s.job.job_type,
                    latitude=s.job.location.latitude,
                    longitude=s.job.location.longitude,
                    duration_hours=s.job.duration_hours,
                    scheduled_time=s.job.scheduled_time.strftime("%H:%M"),
                    current_crew_id=s.job.crew_id,
                    price_sek=round(s.price_sek),
                    risk_level=s.risk_level.value,
                    risk_reasons=reasons.get(s.job.job_id, []),
                    arrival=s.arrival.strftime("%H:%M"),
                    departure=s.departure.strftime("%H:%M"),
                    leg_km=r1(s.leg_km),
                    leg_minutes=round(s.leg_minutes),
                )
                for s in route.stops
            ],
            total_km=r1(route.total_km),
            return_km=r1(route.return_km),
            drive_minutes=round(route.drive_minutes),
            work_hours=r1(route.work_hours),
            total_hours=r1(route.total_hours),
            max_hours=route.crew.max_hours,
            finish_time=route.finish_time.strftime("%H:%M") if route.finish_time else None,
            revenue_sek=round(route.revenue_sek),
            target_sek=route.crew.daily_target_sek,
            target_pct=r1(route.target_pct),
            drive_cost_sek=round(route.drive_cost_sek),
            warnings=route.warnings,
            maps_url=route.maps_url(),
        ))
    working = [r for r in plan.routes if r.stops]
    return PlanOut(
        date=plan.plan_date.isoformat(),
        routes=routes,
        unassigned=[
            UnassignedOut(
                job_id=u.job.job_id,
                address=u.job.address,
                job_type=u.job.job_type,
                latitude=u.job.location.latitude,
                longitude=u.job.location.longitude,
                duration_hours=u.job.duration_hours,
                scheduled_time=u.job.scheduled_time.strftime("%H:%M"),
                current_crew_id=u.job.crew_id,
                price_sek=round(u.price_sek),
                risk_level=u.risk_level.value,
                risk_reasons=reasons.get(u.job.job_id, []),
                reason=u.reason,
            )
            for u in plan.unassigned
        ],
        total_revenue_sek=round(plan.total_revenue_sek),
        total_target_sek=plan.total_target_sek,
        total_km=r1(plan.total_km),
        crews_on_target=sum(
            1 for r in working if r.crew.daily_target_sek and r.revenue_sek >= r.crew.daily_target_sek
        ),
        crews_working=len(working),
    )


@app.get("/api/plan/dates", response_model=list[str])
def plan_dates() -> list[str]:
    """Every date that has at least one job, for the planner's date picker."""
    return sorted({j.scheduled_date.isoformat() for j in _store.list_jobs()})


@app.get("/api/plan", response_model=PlanOut)
def get_plan_proposal(plan_date: date = Query(alias="date")) -> PlanOut:
    """Automatic proposal: who takes which job, in what order. Not saved."""
    jobs, prices, risks, reasons = _planning_inputs(plan_date)
    plan = propose_plan(plan_date, jobs, _crews, prices, risks, _planner_settings)
    return _plan_out(plan, reasons)


@app.get("/api/plan/current", response_model=PlanOut)
def get_current_plan(plan_date: date = Query(alias="date")) -> PlanOut:
    """The day as it is currently assigned in the database, with route figures."""
    jobs, prices, risks, reasons = _planning_inputs(plan_date)
    assignments: dict[str, list[str]] = {}
    for job in sorted(jobs, key=lambda j: j.scheduled_time):
        if job.crew_id:
            assignments.setdefault(job.crew_id, []).append(job.job_id)
    plan = evaluate_plan(plan_date, jobs, _crews, assignments, prices, risks, _planner_settings)
    return _plan_out(plan, reasons)


@app.post("/api/plan/evaluate", response_model=PlanOut)
def evaluate_plan_edit(body: PlanEditRequest) -> PlanOut:
    """Recalculate km, times and totals after a manual move. Not saved."""
    _check_crews(body.assignments)
    jobs, prices, risks, reasons = _planning_inputs(body.date)
    plan = evaluate_plan(
        body.date, jobs, _crews, body.assignments, prices, risks, _planner_settings,
        keep_order_for=set(body.keep_order_for),
    )
    return _plan_out(plan, reasons)


@app.post("/api/plan/apply", response_model=PlanOut)
def apply_plan(body: PlanEditRequest) -> PlanOut:
    """Save the plan: every job that day gets the crew it was planned for
    (or no crew, if it was left unassigned)."""
    _check_crews(body.assignments)
    jobs, prices, risks, reasons = _planning_inputs(body.date)
    day_ids = {j.job_id for j in jobs}
    new_crew: dict[str, str | None] = {job_id: None for job_id in day_ids}
    for crew_id, job_ids in body.assignments.items():
        for job_id in job_ids:
            if job_id in day_ids:
                new_crew[job_id] = crew_id
    _store.update_job_crews(new_crew)

    jobs, prices, risks, reasons = _planning_inputs(body.date)
    plan = evaluate_plan(
        body.date, jobs, _crews, body.assignments, prices, risks, _planner_settings,
        keep_order_for=set(body.keep_order_for),
    )
    return _plan_out(plan, reasons)


def _check_crews(assignments: dict[str, list[str]]) -> None:
    known = {c.crew_id for c in _crews}
    unknown = sorted(set(assignments) - known)
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown crew_id(s): {unknown}")


@app.get("/api/health")
def health() -> dict:
    jobs = _store.list_jobs()
    return {"status": "ok", "jobs_loaded": len(jobs), "crews_loaded": len(_crews)}
