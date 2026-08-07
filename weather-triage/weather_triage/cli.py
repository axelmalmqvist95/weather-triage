"""Command-line entry point.

Usage:
    python -m weather_triage.cli \\
        --jobs data/synthetic_jobs.csv \\
        --profiles config/job_type_profiles.json \\
        --out report.html
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from pathlib import Path

from weather_triage.job_repository import JobDataError, load_job_type_profiles, load_jobs_from_csv
from weather_triage.report import render_html_report, write_html_report
from weather_triage.risk_engine import RiskEngine
from weather_triage.weather_client import OpenMeteoClient, WeatherClientError

logger = logging.getLogger("weather_triage")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Weather-aware job scheduling risk assessment.")
    parser.add_argument("--jobs", type=Path, required=True, help="CSV file of scheduled jobs.")
    parser.add_argument("--profiles", type=Path, required=True, help="JSON file of job-type weather thresholds.")
    parser.add_argument("--out", type=Path, default=Path("report.html"), help="Where to write the HTML report.")
    parser.add_argument("--forecast-days", type=int, default=7, help="Days of forecast to fetch per location.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    try:
        jobs = load_jobs_from_csv(args.jobs)
        profiles = load_job_type_profiles(args.profiles)
    except (JobDataError, FileNotFoundError) as exc:
        logger.error("failed to load input data: %s", exc)
        return 1

    logger.info("loaded %d jobs across %d job types", len(jobs), len(profiles))

    weather_client = OpenMeteoClient()
    engine = RiskEngine(job_profiles=profiles)

    forecasts_by_job_id = {}
    for job in jobs:
        try:
            forecasts_by_job_id[job.job_id] = weather_client.get_daily_forecast(
                job.location, forecast_days=args.forecast_days
            )
        except WeatherClientError as exc:
            logger.warning("no forecast for %s (%s): %s", job.job_id, job.address, exc)
            forecasts_by_job_id[job.job_id] = {}

    assessments = engine.assess_all(jobs, forecasts_by_job_id)

    red_count = sum(1 for a in assessments if a.risk_level.value == "red")
    amber_count = sum(1 for a in assessments if a.risk_level.value == "amber")
    logger.info("assessment complete: %d red, %d amber, %d clear", red_count, amber_count, len(assessments) - red_count - amber_count)

    html = render_html_report(assessments, forecasts_by_job_id, engine, generated_at=date.today())
    write_html_report(args.out, html)
    logger.info("report written to %s", args.out)

    return 0


if __name__ == "__main__":
    sys.exit(main())
