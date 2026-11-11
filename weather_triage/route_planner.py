"""Route planning: who takes which job on a given day, in what order.

Like risk_engine.py this module has no I/O — jobs, crews, prices and risk
levels go in, a plan comes out. That keeps it testable and lets the API
re-run it cheaply every time a dispatcher moves a job by hand.

How a proposal is built:

1. Jobs with a RED weather assessment are left out (they should be moved to
   another day, not driven to). AMBER jobs are planned but flagged.
2. Remaining jobs are placed one by one. For each job, every crew
   with the right skill, within range of its home base and with time left
   in its day is a candidate. The job goes to the candidate where it costs
   the least extra driving — with a bonus for crews that are still short of
   their daily revenue target, so work spreads towards the goals instead of
   piling onto whichever crew happens to sit in the middle of town.
   This greedy pass is repeated over several job orderings and the most
   profitable result (revenue minus driving cost) is kept.
3. Each crew's stops are ordered with nearest-neighbour from home base and
   then improved with 2-opt, so the day becomes one loop rather than a
   zig-zag.

Distances are straight-line (haversine) times a road factor. That is an
estimate — good enough to compare alternatives and spot bad routes, not a
replacement for a navigation app. The plan links each route to Google Maps
for the turn-by-turn part.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from urllib.parse import quote

from weather_triage.models import Coordinates, Crew, Job, RiskLevel

UNASSIGNED = "unassigned"


@dataclass(frozen=True)
class PlannerSettings:
    road_factor: float = 1.3            # straight line -> road distance
    avg_speed_kmh: float = 60.0
    cost_per_km_sek: float = 2.5         # fuel + wear, used to weigh detours
    workday_start: time = time(7, 0)
    max_distance_from_base_km: float = 120.0
    # How much (0-1) of the revenue a crew still needs to hit its target
    # counts as a "bonus" when choosing where a job goes. Higher = spread
    # work more evenly towards targets; lower = minimise driving harder.
    target_weight: float = 0.3
    # What an hour of crew time on the road costs, so a long detour is
    # weighed by lost working time and not just fuel.
    crew_cost_per_hour_sek: float = 500.0
    # Extra randomised greedy passes on top of the fixed orderings.
    extra_attempts: int = 12


@dataclass(frozen=True)
class Stop:
    job: Job
    price_sek: float
    risk_level: RiskLevel
    arrival: time
    departure: time
    leg_km: float          # driving distance from the previous stop
    leg_minutes: float


@dataclass
class Route:
    crew: Crew
    stops: list[Stop]
    total_km: float           # including the drive back to home base
    drive_minutes: float
    work_hours: float
    revenue_sek: float
    drive_cost_sek: float
    return_km: float
    finish_time: time | None
    warnings: list[str] = field(default_factory=list)

    @property
    def target_pct(self) -> float:
        if self.crew.daily_target_sek <= 0:
            return 0.0
        return 100.0 * self.revenue_sek / self.crew.daily_target_sek

    @property
    def total_hours(self) -> float:
        return self.work_hours + self.drive_minutes / 60.0

    def maps_url(self) -> str | None:
        """Google Maps directions: home base -> every stop -> home base."""
        if not self.stops:
            return None
        base = f"{self.crew.home_base.latitude},{self.crew.home_base.longitude}"
        waypoints = "|".join(
            f"{s.job.location.latitude},{s.job.location.longitude}" for s in self.stops
        )
        return (
            "https://www.google.com/maps/dir/?api=1"
            f"&origin={base}&destination={base}"
            f"&waypoints={quote(waypoints, safe=',')}&travelmode=driving"
        )


@dataclass(frozen=True)
class UnassignedJob:
    job: Job
    price_sek: float
    risk_level: RiskLevel
    reason: str


@dataclass
class Plan:
    plan_date: date
    routes: list[Route]
    unassigned: list[UnassignedJob]

    @property
    def total_revenue_sek(self) -> float:
        return sum(r.revenue_sek for r in self.routes)

    @property
    def total_km(self) -> float:
        return sum(r.total_km for r in self.routes)

    @property
    def total_target_sek(self) -> float:
        return sum(r.crew.daily_target_sek for r in self.routes)


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #

def haversine_km(a: Coordinates, b: Coordinates) -> float:
    r = 6371.0
    lat1, lat2 = math.radians(a.latitude), math.radians(b.latitude)
    dlat = lat2 - lat1
    dlng = math.radians(b.longitude - a.longitude)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def road_km(a: Coordinates, b: Coordinates, settings: PlannerSettings) -> float:
    return haversine_km(a, b) * settings.road_factor


def _loop_km(base: Coordinates, jobs: list[Job], settings: PlannerSettings) -> float:
    points = [base, *(j.location for j in jobs), base]
    return sum(road_km(points[i], points[i + 1], settings) for i in range(len(points) - 1))


def optimize_order(base: Coordinates, jobs: list[Job], settings: PlannerSettings) -> list[Job]:
    """Nearest-neighbour from base, then 2-opt until no swap shortens the loop.

    Exact for the handful of stops a crew does per day in practice; even
    at 15+ stops it stays well within a millisecond-range budget.
    """
    remaining = list(jobs)
    ordered: list[Job] = []
    here = base
    while remaining:
        nxt = min(remaining, key=lambda j: road_km(here, j.location, settings))
        ordered.append(nxt)
        remaining.remove(nxt)
        here = nxt.location

    improved = True
    while improved and len(ordered) > 2:
        improved = False
        best = _loop_km(base, ordered, settings)
        for i in range(len(ordered) - 1):
            for k in range(i + 1, len(ordered)):
                candidate = ordered[:i] + ordered[i : k + 1][::-1] + ordered[k + 1 :]
                length = _loop_km(base, candidate, settings)
                if length < best - 1e-9:
                    ordered, best, improved = candidate, length, True
    return ordered


# --------------------------------------------------------------------------- #
# Building one crew's route
# --------------------------------------------------------------------------- #

def build_route(
    crew: Crew,
    jobs: list[Job],
    prices: dict[str, float],
    risks: dict[str, RiskLevel],
    settings: PlannerSettings,
    optimize: bool = True,
) -> Route:
    ordered = optimize_order(crew.home_base, jobs, settings) if optimize else list(jobs)

    clock = datetime.combine(date.min, settings.workday_start)
    here = crew.home_base
    stops: list[Stop] = []
    total_km = 0.0
    for job in ordered:
        leg = road_km(here, job.location, settings)
        leg_min = leg / settings.avg_speed_kmh * 60
        arrival = clock + timedelta(minutes=leg_min)
        departure = arrival + timedelta(hours=job.duration_hours)
        stops.append(
            Stop(
                job=job,
                price_sek=prices.get(job.job_id, 0.0),
                risk_level=risks.get(job.job_id, RiskLevel.GREEN),
                arrival=arrival.time(),
                departure=departure.time(),
                leg_km=leg,
                leg_minutes=leg_min,
            )
        )
        total_km += leg
        clock = departure
        here = job.location

    return_km = road_km(here, crew.home_base, settings) if ordered else 0.0
    total_km += return_km
    finish = clock + timedelta(minutes=return_km / settings.avg_speed_kmh * 60)
    route = Route(
        crew=crew,
        stops=stops,
        total_km=total_km,
        drive_minutes=total_km / settings.avg_speed_kmh * 60,
        work_hours=sum(j.duration_hours for j in ordered),
        revenue_sek=sum(prices.get(j.job_id, 0.0) for j in ordered),
        drive_cost_sek=total_km * settings.cost_per_km_sek,
        return_km=return_km,
        finish_time=finish.time() if ordered else None,
    )
    route.warnings = _route_warnings(route, settings)
    return route


def _route_warnings(route: Route, settings: PlannerSettings) -> list[str]:
    warnings: list[str] = []
    crew = route.crew
    for stop in route.stops:
        job = stop.job
        if crew.skills and job.job_type not in crew.skills:
            warnings.append(f"{job.job_id}: {crew.name} lacks skill '{job.job_type}'")
        # AMBER is shown on the stop itself; only a RED job on a route is
        # serious enough to repeat at route level.
        if stop.risk_level is RiskLevel.RED:
            warnings.append(f"{job.job_id}: weather says reschedule")
        dist = road_km(crew.home_base, job.location, settings)
        if dist > settings.max_distance_from_base_km:
            warnings.append(f"{job.job_id}: {dist:.0f} km from home base")
    if route.stops and route.total_hours > crew.max_hours:
        warnings.append(
            f"Day is {route.total_hours:.1f} h (max {crew.max_hours:.0f} h incl. driving)"
        )
    if route.stops and crew.daily_target_sek > 0 and route.revenue_sek < crew.daily_target_sek:
        gap = crew.daily_target_sek - route.revenue_sek
        warnings.append(f"{gap:,.0f} kr short of daily target".replace(",", " "))
    return warnings


# --------------------------------------------------------------------------- #
# Whole-day plans
# --------------------------------------------------------------------------- #

def propose_plan(
    plan_date: date,
    jobs: list[Job],
    crews: list[Crew],
    prices: dict[str, float],
    risks: dict[str, RiskLevel],
    settings: PlannerSettings = PlannerSettings(),
) -> Plan:
    """Automatic proposal for one day. See module docstring for the method.

    Greedy placement depends on the order jobs are considered in: putting a
    5 h job first can leave no room for two 4 h jobs worth more together.
    So the greedy pass runs over several orderings (by value, by duration,
    plus a few seeded shuffles, so results are repeatable) and the plan
    with the best revenue minus driving cost wins.
    """
    day_jobs = [j for j in jobs if j.scheduled_date == plan_date]
    red = [j for j in day_jobs if risks.get(j.job_id) is RiskLevel.RED]
    plannable = [j for j in day_jobs if risks.get(j.job_id) is not RiskLevel.RED]

    def price(j: Job) -> float:
        return prices.get(j.job_id, 0.0)

    orderings = [
        sorted(plannable, key=lambda j: (-price(j), j.job_id)),
        sorted(plannable, key=lambda j: (j.duration_hours, -price(j), j.job_id)),
        sorted(plannable, key=lambda j: (-price(j) / max(j.duration_hours, 0.1), j.job_id)),
    ]
    rng = random.Random(f"{plan_date.isoformat()}:{len(plannable)}")
    for _ in range(settings.extra_attempts):
        shuffled = sorted(plannable, key=lambda j: j.job_id)
        rng.shuffle(shuffled)
        orderings.append(shuffled)

    best: Plan | None = None
    best_value = -math.inf
    for order in orderings:
        plan = _greedy_plan(plan_date, order, crews, prices, risks, settings)
        value = sum(
            r.revenue_sek
            - r.drive_cost_sek
            - r.drive_minutes / 60 * settings.crew_cost_per_hour_sek
            for r in plan.routes
        )
        if value > best_value + 1e-6:
            best, best_value = plan, value

    assert best is not None
    best.unassigned = [
        UnassignedJob(j, price(j), RiskLevel.RED, "Weather: reschedule recommended") for j in red
    ] + best.unassigned
    return best


def _greedy_plan(
    plan_date: date,
    ordered_jobs: list[Job],
    crews: list[Crew],
    prices: dict[str, float],
    risks: dict[str, RiskLevel],
    settings: PlannerSettings,
) -> Plan:
    """One greedy pass: place each job, in the given order, where it costs least."""
    assigned: dict[str, list[Job]] = {c.crew_id: [] for c in crews}
    unassigned: list[UnassignedJob] = []

    def unassign(job: Job, reason: str) -> None:
        unassigned.append(
            UnassignedJob(job, prices.get(job.job_id, 0.0), risks.get(job.job_id, RiskLevel.GREEN), reason)
        )

    for job in ordered_jobs:
        skilled = [c for c in crews if not c.skills or job.job_type in c.skills]
        if not skilled:
            unassign(job, f"No crew has skill '{job.job_type}'")
            continue
        in_range = [
            c for c in skilled
            if road_km(c.home_base, job.location, settings) <= settings.max_distance_from_base_km
        ]
        if not in_range:
            unassign(job, f"No skilled crew within {settings.max_distance_from_base_km:.0f} km")
            continue

        best_crew: Crew | None = None
        best_score = math.inf
        for crew in in_range:
            current = assigned[crew.crew_id]
            before = _loop_km(crew.home_base, current, settings) if current else 0.0
            trial = optimize_order(crew.home_base, [*current, job], settings)
            after = _loop_km(crew.home_base, trial, settings)
            hours = sum(j.duration_hours for j in trial) + after / settings.avg_speed_kmh
            if hours > crew.max_hours:
                continue
            extra_km = after - before
            revenue_now = sum(prices.get(j.job_id, 0.0) for j in current)
            gap = max(0.0, crew.daily_target_sek - revenue_now)
            bonus = settings.target_weight * min(prices.get(job.job_id, 0.0), gap)
            extra_cost = extra_km * settings.cost_per_km_sek + (
                extra_km / settings.avg_speed_kmh * settings.crew_cost_per_hour_sek
            )
            score = extra_cost - bonus
            if score < best_score - 1e-9:
                best_crew, best_score = crew, score
        if best_crew is None:
            names = ", ".join(c.name for c in in_range)
            unassign(job, f"Fully booked: {names}")
            continue
        assigned[best_crew.crew_id].append(job)

    routes = [build_route(c, assigned[c.crew_id], prices, risks, settings) for c in crews]
    return Plan(plan_date=plan_date, routes=routes, unassigned=unassigned)


def evaluate_plan(
    plan_date: date,
    jobs: list[Job],
    crews: list[Crew],
    assignments: dict[str, list[str]],
    prices: dict[str, float],
    risks: dict[str, RiskLevel],
    settings: PlannerSettings = PlannerSettings(),
    keep_order_for: set[str] | None = None,
) -> Plan:
    """Recalculate a plan the dispatcher has edited by hand.

    ``assignments`` maps crew_id -> job_ids. Crews listed in
    ``keep_order_for`` keep the given stop order; everyone else's route is
    re-optimised. Jobs for the day that aren't in any crew's list end up
    unassigned. Nothing is refused here — a skill mismatch or an overlong
    day is shown as a warning, because the dispatcher may know something
    the planner doesn't.
    """
    keep_order_for = keep_order_for or set()
    day_jobs = {j.job_id: j for j in jobs if j.scheduled_date == plan_date}
    placed: set[str] = set()
    routes = []
    for crew in crews:
        crew_jobs = []
        for job_id in assignments.get(crew.crew_id, []):
            if job_id in day_jobs and job_id not in placed:
                crew_jobs.append(day_jobs[job_id])
                placed.add(job_id)
        routes.append(
            build_route(
                crew, crew_jobs, prices, risks, settings,
                optimize=crew.crew_id not in keep_order_for,
            )
        )

    unassigned = [
        UnassignedJob(
            job, prices.get(job_id, 0.0), risks.get(job_id, RiskLevel.GREEN),
            "Weather: reschedule recommended" if risks.get(job_id) is RiskLevel.RED else "Not assigned",
        )
        for job_id, job in day_jobs.items()
        if job_id not in placed
    ]
    return Plan(plan_date=plan_date, routes=routes, unassigned=unassigned)
