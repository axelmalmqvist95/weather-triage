from datetime import date, time

import pytest

from weather_triage.job_repository import job_price
from weather_triage.models import Coordinates, Crew, Job, RiskLevel
from weather_triage.route_planner import (
    PlannerSettings,
    build_route,
    evaluate_plan,
    haversine_km,
    optimize_order,
    propose_plan,
)

DAY = date(2026, 8, 10)
SETTINGS = PlannerSettings()

LUND = Coordinates(55.705, 13.191)
MALMO = Coordinates(55.605, 13.000)
STOCKHOLM = Coordinates(59.334, 18.063)


def job(job_id, loc, job_type="facade_wash", hours=2.0, price=None, d=DAY, crew_id=None):
    return Job(
        job_id=job_id, scheduled_date=d, scheduled_time=time(8, 0), location=loc,
        address=f"{job_id} street", job_type=job_type, duration_hours=hours,
        crew_id=crew_id, price_sek=price,
    )


def crew(crew_id, base, skills=("facade_wash",), target=5000.0, max_hours=9.0):
    return Crew(crew_id=crew_id, name=crew_id, home_base=base, skills=list(skills),
                daily_target_sek=target, max_hours=max_hours)


def prices_of(jobs):
    return {j.job_id: j.price_sek or 0.0 for j in jobs}


def test_haversine_lund_malmo_is_about_17_km():
    assert haversine_km(LUND, MALMO) == pytest.approx(17, abs=2)


def test_optimize_order_avoids_zigzag():
    # Points on a line east of base, given out of order.
    base = Coordinates(55.0, 13.0)
    a, b, c = (job(n, Coordinates(55.0, 13.0 + x)) for n, x in (("A", 0.1), ("B", 0.2), ("C", 0.3)))
    ordered = optimize_order(base, [c, a, b], SETTINGS)
    assert [j.job_id for j in ordered] in (["A", "B", "C"], ["C", "B", "A"])


def test_build_route_sums_revenue_km_and_times():
    c = crew("C1", LUND)
    jobs = [job("J1", MALMO, hours=2, price=3000), job("J2", MALMO, hours=1, price=1000)]
    route = build_route(c, jobs, prices_of(jobs), {}, SETTINGS)

    assert route.revenue_sek == 4000
    assert route.work_hours == 3
    # Out to Malmö and back, second stop is at the same spot.
    expected = 2 * haversine_km(LUND, MALMO) * SETTINGS.road_factor
    assert route.total_km == pytest.approx(expected, rel=1e-6)
    assert route.stops[0].arrival > SETTINGS.workday_start
    assert route.stops[1].arrival == route.stops[0].departure  # no drive between
    assert route.target_pct == pytest.approx(80.0)
    assert route.maps_url().startswith("https://www.google.com/maps/dir/")


def test_proposal_respects_skills():
    painter = crew("P", LUND, skills=("painting",))
    washer = crew("W", MALMO, skills=("facade_wash",))
    jobs = [job("J1", LUND, job_type="facade_wash", price=2000)]
    plan = propose_plan(DAY, jobs, [painter, washer], prices_of(jobs), {}, SETTINGS)

    by_crew = {r.crew.crew_id: [s.job.job_id for s in r.stops] for r in plan.routes}
    assert by_crew == {"P": [], "W": ["J1"]}


def test_proposal_picks_nearest_crew_when_targets_equal():
    near = crew("NEAR", LUND)
    far = crew("FAR", MALMO)
    jobs = [job("J1", Coordinates(55.70, 13.19), price=2000)]
    plan = propose_plan(DAY, jobs, [near, far], prices_of(jobs), {}, SETTINGS)
    assert plan.routes[0].stops[0].job.job_id == "J1"
    assert plan.routes[1].stops == []


def test_proposal_spreads_work_toward_targets():
    # Two crews side by side; four equal jobs. Pure distance would be a
    # coin-flip, the target bonus should split them so both get revenue.
    a = crew("A", LUND, target=4000)
    b = crew("B", Coordinates(55.706, 13.192), target=4000)
    jobs = [job(f"J{i}", Coordinates(55.70 + i * 0.001, 13.19), hours=1, price=2000) for i in range(4)]
    plan = propose_plan(DAY, jobs, [a, b], prices_of(jobs), {}, SETTINGS)
    assert [r.revenue_sek for r in plan.routes] == [4000, 4000]


def test_red_weather_jobs_are_left_unassigned():
    c = crew("C1", LUND)
    jobs = [job("J1", LUND, price=1000), job("J2", LUND, price=1000)]
    plan = propose_plan(DAY, jobs, [c], prices_of(jobs), {"J2": RiskLevel.RED}, SETTINGS)
    assert [s.job.job_id for s in plan.routes[0].stops] == ["J1"]
    assert plan.unassigned[0].job.job_id == "J2"
    assert "Weather" in plan.unassigned[0].reason


def test_out_of_range_and_capacity_are_reported():
    c = crew("C1", LUND, max_hours=5)
    jobs = [
        job("FAR", STOCKHOLM, price=9000),
        job("BIG", LUND, hours=4, price=5000),
        job("SMALL", LUND, hours=2, price=1000),  # doesn't fit after BIG
    ]
    plan = propose_plan(DAY, jobs, [c], prices_of(jobs), {}, SETTINGS)
    reasons = {u.job.job_id: u.reason for u in plan.unassigned}
    assert "within" in reasons["FAR"]
    assert "Fully booked" in reasons["SMALL"]
    assert [s.job.job_id for s in plan.routes[0].stops] == ["BIG"]


def test_proposal_only_uses_jobs_on_the_plan_date():
    c = crew("C1", LUND)
    jobs = [job("TODAY", LUND, price=1000), job("OTHER", LUND, price=1000, d=date(2026, 8, 11))]
    plan = propose_plan(DAY, jobs, [c], prices_of(jobs), {}, SETTINGS)
    assert [s.job.job_id for s in plan.routes[0].stops] == ["TODAY"]
    assert plan.unassigned == []


def test_evaluate_manual_move_warns_instead_of_refusing():
    painter = crew("P", LUND, skills=("painting",), max_hours=1)
    jobs = [job("J1", LUND, job_type="facade_wash", hours=3, price=2000), job("J2", LUND, price=500)]
    plan = evaluate_plan(DAY, jobs, [painter], {"P": ["J1"]}, prices_of(jobs), {}, SETTINGS)

    route = plan.routes[0]
    assert [s.job.job_id for s in route.stops] == ["J1"]
    assert any("lacks skill" in w for w in route.warnings)
    assert any("max 1 h" in w for w in route.warnings)
    assert [u.job.job_id for u in plan.unassigned] == ["J2"]


def test_evaluate_keeps_manual_order_when_asked():
    base = Coordinates(55.0, 13.0)
    c = crew("C1", base)
    a, b, cc = (job(n, Coordinates(55.0, 13.0 + x)) for n, x in (("A", 0.1), ("B", 0.2), ("C", 0.3)))
    jobs = [a, b, cc]
    manual = ["C", "A", "B"]

    kept = evaluate_plan(DAY, jobs, [c], {"C1": manual}, {}, {}, SETTINGS, keep_order_for={"C1"})
    optimised = evaluate_plan(DAY, jobs, [c], {"C1": manual}, {}, {}, SETTINGS)

    assert [s.job.job_id for s in kept.routes[0].stops] == manual
    assert optimised.routes[0].total_km < kept.routes[0].total_km


def test_job_price_falls_back_to_hourly_rate():
    rates = {"facade_wash": 1000}
    assert job_price(job("J1", LUND, hours=3), rates) == 3000
    assert job_price(job("J1", LUND, hours=3, price=4200), rates) == 4200


def test_proposal_prefers_two_smaller_jobs_over_one_big_when_worth_more():
    # Value-first greedy would take the 5 h job and have no room left;
    # two 4 h jobs fill the day and earn more.
    c = crew("C1", LUND, max_hours=8.5)
    jobs = [
        job("BIG", LUND, hours=5, price=5000),
        job("S1", LUND, hours=4, price=3600),
        job("S2", LUND, hours=4, price=3600),
    ]
    plan = propose_plan(DAY, jobs, [c], prices_of(jobs), {}, SETTINGS)
    assert sorted(s.job.job_id for s in plan.routes[0].stops) == ["S1", "S2"]
    assert plan.routes[0].revenue_sek == 7200


def test_proposal_is_deterministic():
    crews_ = [crew("A", LUND), crew("B", MALMO)]
    jobs = [job(f"J{i}", Coordinates(55.6 + i * 0.01, 13.0 + i * 0.01), hours=2, price=1000 + i * 100)
            for i in range(8)]
    ids = lambda p: [[s.job.job_id for s in r.stops] for r in p.routes]
    first = propose_plan(DAY, jobs, crews_, prices_of(jobs), {}, SETTINGS)
    second = propose_plan(DAY, jobs, crews_, prices_of(jobs), {}, SETTINGS)
    assert ids(first) == ids(second)
