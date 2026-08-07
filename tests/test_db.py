from datetime import date, time
from pathlib import Path

import pytest

from weather_triage.db import JobStore
from weather_triage.models import Coordinates, Job


def make_job(job_id="J1", d=date(2026, 8, 10)) -> Job:
    return Job(
        job_id=job_id,
        scheduled_date=d,
        scheduled_time=time(9, 0),
        location=Coordinates(latitude=55.6, longitude=13.0),
        address="Test Street 1",
        job_type="facade_wash",
        duration_hours=3,
        crew_id="C1",
    )


@pytest.fixture
def store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "test.db")


def test_new_store_is_empty(store):
    assert store.is_empty()
    assert store.list_jobs() == []


def test_create_and_list_job(store):
    store.create_job(make_job())

    jobs = store.list_jobs()

    assert len(jobs) == 1
    assert jobs[0].job_id == "J1"
    assert not store.is_empty()


def test_seed_from_does_not_duplicate_on_conflict(store):
    store.seed_from([make_job("J1"), make_job("J2")])
    store.seed_from([make_job("J1")])  # re-seeding same id should not duplicate

    assert len(store.list_jobs()) == 2


def test_update_job_date_persists(store):
    store.create_job(make_job("J1", d=date(2026, 8, 10)))

    store.update_job_date("J1", date(2026, 8, 15))

    updated = store.get_job("J1")
    assert updated.scheduled_date == date(2026, 8, 15)


def test_delete_job_removes_it_and_its_history(store):
    store.create_job(make_job("J1"))
    store.record_snapshot("J1", date(2026, 8, 7), "green", [], None)

    store.delete_job("J1")

    assert store.get_job("J1") is None
    assert store.get_history("J1") == []


def test_snapshot_same_day_overwrites_not_duplicates(store):
    store.create_job(make_job("J1"))
    today = date(2026, 8, 7)

    store.record_snapshot("J1", today, "red", ["wind too high"], date(2026, 8, 9))
    store.record_snapshot("J1", today, "green", [], None)  # re-assessed same day

    history = store.get_history("J1")
    assert len(history) == 1
    assert history[0]["risk_level"] == "green"


def test_snapshot_different_days_accumulate_history(store):
    store.create_job(make_job("J1"))

    store.record_snapshot("J1", date(2026, 8, 7), "red", ["wind too high"], None)
    store.record_snapshot("J1", date(2026, 8, 8), "green", [], None)

    history = store.get_history("J1")
    assert len(history) == 2
    # Most recent first.
    assert history[0]["snapshot_date"] == "2026-08-08"
    assert history[1]["snapshot_date"] == "2026-08-07"


def test_history_for_unknown_job_is_empty_not_an_error(store):
    assert store.get_history("NOPE") == []
