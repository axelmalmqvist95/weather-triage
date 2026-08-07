"""Core domain models for the weather triage system.

These types are the vocabulary the rest of the system speaks in. Keeping
them explicit (rather than passing dicts around) is what makes the risk
engine's decisions traceable back to a specific job, a specific threshold,
and a specific forecast value.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time
from enum import Enum


class RiskLevel(str, Enum):
    GREEN = "green"    # Proceed as scheduled.
    AMBER = "amber"     # Marginal — flag for human review.
    RED = "red"      # Reschedule recommended.


@dataclass(frozen=True)
class Coordinates:
    latitude: float
    longitude: float

    def __post_init__(self) -> None:
        if not -90 <= self.latitude <= 90:
            raise ValueError(f"latitude out of range: {self.latitude}")
        if not -180 <= self.longitude <= 180:
            raise ValueError(f"longitude out of range: {self.longitude}")


@dataclass(frozen=True)
class JobTypeProfile:
    """Weather tolerance thresholds for one category of outdoor work.

    A threshold set to ``None`` means that dimension is not a constraint
    for this job type (e.g. gutter cleaning tolerates light rain fine,
    but painting does not tolerate any).
    """

    name: str
    max_wind_speed_ms: float | None
    max_precipitation_mm: float | None
    min_temperature_c: float | None
    max_temperature_c: float | None = None

    def violations(self, forecast: "DailyForecast") -> list[str]:
        """Return a human-readable list of every threshold this forecast breaks."""
        reasons: list[str] = []

        if self.max_wind_speed_ms is not None and forecast.max_wind_speed_ms > self.max_wind_speed_ms:
            reasons.append(
                f"wind {forecast.max_wind_speed_ms:.1f} m/s exceeds limit "
                f"{self.max_wind_speed_ms:.1f} m/s"
            )
        if self.max_precipitation_mm is not None and forecast.precipitation_mm > self.max_precipitation_mm:
            reasons.append(
                f"precipitation {forecast.precipitation_mm:.1f} mm exceeds limit "
                f"{self.max_precipitation_mm:.1f} mm"
            )
        if self.min_temperature_c is not None and forecast.min_temperature_c < self.min_temperature_c:
            reasons.append(
                f"temperature {forecast.min_temperature_c:.1f}°C below minimum "
                f"{self.min_temperature_c:.1f}°C"
            )
        if self.max_temperature_c is not None and forecast.max_temperature_c > self.max_temperature_c:
            reasons.append(
                f"temperature {forecast.max_temperature_c:.1f}°C above maximum "
                f"{self.max_temperature_c:.1f}°C"
            )
        return reasons


@dataclass(frozen=True)
class Crew:
    """A field crew (one or more technicians) that can be assigned to jobs.

    availability tracks which dates this crew is already booked — the
    dispatch grid and reschedule suggestions both need this to avoid
    recommending a date the crew isn't actually free.
    """

    crew_id: str
    name: str
    home_base: Coordinates
    skills: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Job:
    job_id: str
    scheduled_date: date
    scheduled_time: time
    location: Coordinates
    address: str
    job_type: str
    duration_hours: float
    crew_id: str | None = None


@dataclass(frozen=True)
class DailyForecast:
    """Aggregated weather for a single calendar day at a single location."""

    forecast_date: date
    max_wind_speed_ms: float
    precipitation_mm: float
    min_temperature_c: float
    max_temperature_c: float


@dataclass(frozen=True)
class RiskAssessment:
    job: Job
    risk_level: RiskLevel
    reasons: list[str] = field(default_factory=list)
    suggested_reschedule_date: date | None = None

    def summary_line(self) -> str:
        if self.risk_level is RiskLevel.GREEN:
            return f"{self.job.job_id}: proceed as scheduled"
        base = f"{self.job.job_id}: {self.risk_level.value.upper()} — " + "; ".join(self.reasons)
        if self.suggested_reschedule_date:
            base += f" — next viable window: {self.suggested_reschedule_date.isoformat()}"
        return base
