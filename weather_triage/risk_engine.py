"""Risk scoring: the decision layer between raw forecast data and a
reschedule recommendation.

Design intent: this module contains zero I/O. It only takes data structures
in and returns data structures out. That separation is what makes it
unit-testable without mocking an HTTP client, and swappable later (e.g. if
a company wants to plug in a paid, higher-accuracy forecast provider
instead of Open-Meteo, only weather_client.py changes — this file doesn't).
"""

from __future__ import annotations

from datetime import date, timedelta

from weather_triage.models import (
    DailyForecast,
    Job,
    JobTypeProfile,
    RiskAssessment,
    RiskLevel,
)

# A forecast that violates a threshold by less than this margin is treated
# as AMBER (flag for human judgement) rather than RED (auto-suggest reschedule).
# This avoids the tool crying wolf on borderline calls — e.g. a wind
# forecast of 8.3 m/s against an 8.0 m/s limit is noise, not a hard stop.
_MARGINAL_TOLERANCE = {
    "wind_ms": 1.0,
    "precipitation_mm": 0.5,
    "temperature_c": 1.0,
}


class RiskEngine:
    def __init__(self, job_profiles: dict[str, JobTypeProfile]) -> None:
        self._job_profiles = job_profiles

    def assess(
        self,
        job: Job,
        forecasts_by_date: dict[date, DailyForecast],
        search_window_days: int = 7,
    ) -> RiskAssessment:
        profile = self._resolve_profile(job)
        forecast = forecasts_by_date.get(job.scheduled_date)

        if forecast is None:
            return RiskAssessment(
                job=job,
                risk_level=RiskLevel.AMBER,
                reasons=[f"no forecast available for {job.scheduled_date.isoformat()}"],
            )

        violations = profile.violations(forecast)
        if not violations:
            return RiskAssessment(job=job, risk_level=RiskLevel.GREEN)

        severity = self._classify_severity(profile, forecast)
        suggestion = None
        if severity is RiskLevel.RED:
            suggestion = self._next_viable_date(
                profile, forecasts_by_date, after=job.scheduled_date, window_days=search_window_days
            )

        return RiskAssessment(
            job=job,
            risk_level=severity,
            reasons=violations,
            suggested_reschedule_date=suggestion,
        )

    def assess_all(
        self,
        jobs: list[Job],
        forecasts_by_job_id: dict[str, dict[date, DailyForecast]],
    ) -> list[RiskAssessment]:
        return [
            self.assess(job, forecasts_by_job_id.get(job.job_id, {}))
            for job in jobs
        ]

    def day_risk(self, job_type: str, forecast: DailyForecast) -> RiskLevel:
        """Public helper for reporting: risk level for one job type on one
        specific day's forecast, independent of any particular Job instance.
        Used to render week-ahead outlook strips without re-running assess().
        """
        profile = self._job_profiles[job_type]
        if not profile.violations(forecast):
            return RiskLevel.GREEN
        return self._classify_severity(profile, forecast)

    def _resolve_profile(self, job: Job) -> JobTypeProfile:
        try:
            return self._job_profiles[job.job_type]
        except KeyError as exc:
            raise ValueError(
                f"job {job.job_id} references unknown job_type '{job.job_type}'; "
                f"known types: {sorted(self._job_profiles)}"
            ) from exc

    @staticmethod
    def _classify_severity(profile: JobTypeProfile, forecast: DailyForecast) -> RiskLevel:
        """A violation is AMBER if every breach is within tolerance, else RED."""
        within_tolerance = True

        if profile.max_wind_speed_ms is not None:
            over = forecast.max_wind_speed_ms - profile.max_wind_speed_ms
            if over > _MARGINAL_TOLERANCE["wind_ms"]:
                within_tolerance = False

        if profile.max_precipitation_mm is not None:
            over = forecast.precipitation_mm - profile.max_precipitation_mm
            if over > _MARGINAL_TOLERANCE["precipitation_mm"]:
                within_tolerance = False

        if profile.min_temperature_c is not None:
            under = profile.min_temperature_c - forecast.min_temperature_c
            if under > _MARGINAL_TOLERANCE["temperature_c"]:
                within_tolerance = False

        return RiskLevel.AMBER if within_tolerance else RiskLevel.RED

    @staticmethod
    def _next_viable_date(
        profile: JobTypeProfile,
        forecasts_by_date: dict[date, DailyForecast],
        after: date,
        window_days: int,
    ) -> date | None:
        for offset in range(1, window_days + 1):
            candidate_date = after + timedelta(days=offset)
            forecast = forecasts_by_date.get(candidate_date)
            if forecast is None:
                continue
            if not profile.violations(forecast):
                return candidate_date
        return None
