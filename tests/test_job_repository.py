import json
from pathlib import Path

import pytest

from weather_triage.job_repository import JobDataError, load_job_type_profiles, load_jobs_from_csv


def test_loads_valid_jobs_csv(tmp_path: Path):
    csv_content = (
        "job_id,date,time,latitude,longitude,address,job_type,duration_hours\n"
        "J1,2026-08-10,09:00,55.60,13.00,\"Storgatan 4, Malmö\",facade_wash,3\n"
    )
    csv_path = tmp_path / "jobs.csv"
    csv_path.write_text(csv_content, encoding="utf-8")

    jobs = load_jobs_from_csv(csv_path)

    assert len(jobs) == 1
    assert jobs[0].job_id == "J1"
    assert jobs[0].job_type == "facade_wash"
    assert jobs[0].location.latitude == 55.60


def test_malformed_row_raises_with_line_number(tmp_path: Path):
    csv_content = (
        "job_id,date,time,latitude,longitude,address,job_type,duration_hours\n"
        "J1,not-a-date,09:00,55.60,13.00,Address,facade_wash,3\n"
    )
    csv_path = tmp_path / "jobs.csv"
    csv_path.write_text(csv_content, encoding="utf-8")

    with pytest.raises(JobDataError, match="line 2"):
        load_jobs_from_csv(csv_path)


def test_loads_job_type_profiles(tmp_path: Path):
    profiles_path = tmp_path / "profiles.json"
    profiles_path.write_text(
        json.dumps({"facade_wash": {"max_wind_ms": 8, "max_rain_mm": 2, "min_temp_c": 2}}),
        encoding="utf-8",
    )

    profiles = load_job_type_profiles(profiles_path)

    assert "facade_wash" in profiles
    assert profiles["facade_wash"].max_wind_speed_ms == 8
