from datetime import date, time

import pytest

from weather_triage.models import Coordinates, DailyForecast, Job, JobTypeProfile, RiskLevel
from weather_triage.risk_engine import RiskEngine

LOCATION = Coordinates(latitude=55.60, longitude=13.00)
JOB_DATE = date(2026, 8, 10)


def make_job(job_type: str = "facade_wash") -> Job:
    return Job(
        job_id="J1",
        scheduled_date=JOB_DATE,
        scheduled_time=time(9, 0),
        location=LOCATION,
        address="Test Street 1",
        job_type=job_type,
        duration_hours=3,
    )


def make_forecast(
    d: date,
    wind: float = 3.0,
    rain: float = 0.0,
    temp_min: float = 12.0,
    temp_max: float = 20.0,
) -> DailyForecast:
    return DailyForecast(
        forecast_date=d,
        max_wind_speed_ms=wind,
        precipitation_mm=rain,
        min_temperature_c=temp_min,
        max_temperature_c=temp_max,
    )


@pytest.fixture
def profiles() -> dict[str, JobTypeProfile]:
    return {
        "facade_wash": JobTypeProfile(
            name="facade_wash", max_wind_speed_ms=8, max_precipitation_mm=2, min_temperature_c=2
        ),
        "painting": JobTypeProfile(
            name="painting", max_wind_speed_ms=5, max_precipitation_mm=0, min_temperature_c=5
        ),
    }


def test_calm_weather_is_green(profiles):
    engine = RiskEngine(profiles)
    job = make_job("facade_wash")
    forecasts = {JOB_DATE: make_forecast(JOB_DATE, wind=3, rain=0, temp_min=12)}

    result = engine.assess(job, forecasts)

    assert result.risk_level is RiskLevel.GREEN
    assert result.reasons == []
    assert result.suggested_reschedule_date is None


def test_severe_wind_is_red_with_reason(profiles):
    engine = RiskEngine(profiles)
    job = make_job("facade_wash")
    forecasts = {JOB_DATE: make_forecast(JOB_DATE, wind=15, rain=0, temp_min=12)}

    result = engine.assess(job, forecasts)

    assert result.risk_level is RiskLevel.RED
    assert any("wind" in reason for reason in result.reasons)


def test_marginal_breach_is_amber_not_red(profiles):
    # 8.5 m/s against an 8.0 m/s limit is within the 1.0 m/s tolerance band.
    engine = RiskEngine(profiles)
    job = make_job("facade_wash")
    forecasts = {JOB_DATE: make_forecast(JOB_DATE, wind=8.5, rain=0, temp_min=12)}

    result = engine.assess(job, forecasts)

    assert result.risk_level is RiskLevel.AMBER


def test_red_assessment_suggests_next_viable_date(profiles):
    engine = RiskEngine(profiles)
    job = make_job("painting")
    forecasts = {
        JOB_DATE: make_forecast(JOB_DATE, wind=12, rain=0, temp_min=10),  # too windy
        JOB_DATE.replace(day=11): make_forecast(JOB_DATE.replace(day=11), wind=12, rain=0),  # still too windy
        JOB_DATE.replace(day=12): make_forecast(JOB_DATE.replace(day=12), wind=2, rain=0, temp_min=10),  # calm
    }

    result = engine.assess(job, forecasts, search_window_days=7)

    assert result.risk_level is RiskLevel.RED
    assert result.suggested_reschedule_date == JOB_DATE.replace(day=12)


def test_missing_forecast_is_amber_not_a_crash(profiles):
    engine = RiskEngine(profiles)
    job = make_job("facade_wash")

    result = engine.assess(job, forecasts_by_date={})

    assert result.risk_level is RiskLevel.AMBER
    assert "no forecast" in result.reasons[0]


def test_unknown_job_type_raises_clear_error(profiles):
    engine = RiskEngine(profiles)
    job = make_job("underwater_basket_weaving")

    with pytest.raises(ValueError, match="unknown job_type"):
        engine.assess(job, forecasts_by_date={JOB_DATE: make_forecast(JOB_DATE)})


def test_rain_intolerant_job_type_flags_any_rain(profiles):
    engine = RiskEngine(profiles)
    job = make_job("painting")
    forecasts = {JOB_DATE: make_forecast(JOB_DATE, wind=2, rain=0.3, temp_min=10)}

    result = engine.assess(job, forecasts)

    assert result.risk_level is not RiskLevel.GREEN
    assert any("precipitation" in reason for reason in result.reasons)
