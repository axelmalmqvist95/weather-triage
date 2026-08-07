"""Renders a self-contained HTML dispatch report from risk assessments.

Design intent (not incidental): this reads like an operations dispatch
board, not a marketing page. The audience is someone deciding tomorrow's
crew assignments at 6am, not someone evaluating a SaaS landing page.
Every visual choice below is in service of that: dense information,
scannable status, a week-ahead outlook strip per job instead of a single
flat badge, muted signal colors instead of stock traffic-light red/green.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from weather_triage.models import DailyForecast, Job, RiskAssessment, RiskLevel
from weather_triage.risk_engine import RiskEngine

_RISK_COLOR = {
    RiskLevel.GREEN: "#4A9B7F",
    RiskLevel.AMBER: "#C98A3B",
    RiskLevel.RED: "#C0524A",
}

_RISK_LABEL = {
    RiskLevel.GREEN: "CLEAR",
    RiskLevel.AMBER: "REVIEW",
    RiskLevel.RED: "RESCHEDULE",
}

_CSS = """
:root {
  --bg: #14181C;
  --surface: #1B2126;
  --surface-raised: #212830;
  --border: #2B333B;
  --text: #E8EAED;
  --text-muted: #8B96A1;
  --accent: #5B8DBE;
  --green: #4A9B7F;
  --amber: #C98A3B;
  --red: #C0524A;
  --font-display: "Space Grotesk", "Archivo", sans-serif;
  --font-data: "IBM Plex Mono", "SFMono-Regular", monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 14px;
  line-height: 1.5;
}

header {
  padding: 32px 40px 24px;
  border-bottom: 1px solid var(--border);
}

header .eyebrow {
  font-family: var(--font-data);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  text-transform: uppercase;
}

header h1 {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 28px;
  margin: 6px 0 4px;
  letter-spacing: -0.01em;
}

header .meta {
  color: var(--text-muted);
  font-size: 12px;
}

.stat-strip {
  display: flex;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  margin: 24px 40px 0;
}

.stat {
  flex: 1;
  background: var(--surface);
  padding: 16px 20px;
}

.stat .count {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 600;
}

.stat .label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-top: 2px;
}

main {
  padding: 24px 40px 48px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead th {
  text-align: left;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 500;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

tbody td {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

tbody tr:hover { background: var(--surface); }

.job-id { color: var(--text-muted); }

.status-pill {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 2px;
  font-size: 11px;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.reasons {
  color: var(--text-muted);
  font-size: 12px;
  max-width: 340px;
}

.outlook {
  display: flex;
  gap: 3px;
}

.outlook .day {
  width: 18px;
  height: 18px;
  border-radius: 2px;
  position: relative;
}

.outlook .day .tooltip {
  visibility: hidden;
  position: absolute;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  padding: 4px 6px;
  font-size: 10px;
  white-space: nowrap;
  z-index: 10;
}

.outlook .day:hover .tooltip { visibility: visible; }

.suggested {
  color: var(--accent);
  font-size: 12px;
}

footer {
  padding: 20px 40px;
  color: var(--text-muted);
  font-size: 11px;
  border-top: 1px solid var(--border);
}
"""


def _week_outlook_html(
    engine: RiskEngine,
    job: Job,
    forecasts: dict[date, DailyForecast],
    days: int = 7,
) -> str:
    cells = []
    for offset in range(days):
        day = job.scheduled_date + timedelta(days=offset)
        forecast = forecasts.get(day)
        if forecast is None:
            color, label = "#3A424A", "no data"
        else:
            level = engine.day_risk(job.job_type, forecast)
            color = _RISK_COLOR[level]
            label = (
                f"{day.isoformat()} — {_RISK_LABEL[level]} "
                f"({forecast.max_wind_speed_ms:.0f} m/s, "
                f"{forecast.precipitation_mm:.0f} mm, "
                f"{forecast.min_temperature_c:.0f}–{forecast.max_temperature_c:.0f}°C)"
            )
        cells.append(
            f'<div class="day" style="background:{color}">'
            f'<div class="tooltip">{label}</div></div>'
        )
    return f'<div class="outlook">{"".join(cells)}</div>'


def render_html_report(
    assessments: list[RiskAssessment],
    forecasts_by_job_id: dict[str, dict[date, DailyForecast]],
    engine: RiskEngine,
    generated_at: date,
) -> str:
    counts = {level: 0 for level in RiskLevel}
    for a in assessments:
        counts[a.risk_level] += 1

    rows = []
    for a in assessments:
        job = a.job
        forecasts = forecasts_by_job_id.get(job.job_id, {})
        outlook = _week_outlook_html(engine, job, forecasts)
        reasons = "; ".join(a.reasons) if a.reasons else "—"
        suggestion = (
            f'<div class="suggested">→ next viable: {a.suggested_reschedule_date.isoformat()}</div>'
            if a.suggested_reschedule_date
            else ""
        )
        rows.append(f"""
        <tr>
          <td class="job-id">{job.job_id}</td>
          <td>{job.scheduled_date.isoformat()} {job.scheduled_time.strftime('%H:%M')}</td>
          <td>{job.address}</td>
          <td>{job.job_type.replace('_', ' ')}</td>
          <td><span class="status-pill" style="background:{_RISK_COLOR[a.risk_level]}22;color:{_RISK_COLOR[a.risk_level]}">{_RISK_LABEL[a.risk_level]}</span></td>
          <td class="reasons">{reasons}{suggestion}</td>
          <td>{outlook}</td>
        </tr>""")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Weather Triage — Dispatch Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>{_CSS}</style>
</head>
<body>
<header>
  <div class="eyebrow">Weather Triage · Dispatch Report</div>
  <h1>Tomorrow's field schedule</h1>
  <div class="meta">Generated {generated_at.isoformat()} · {len(assessments)} jobs assessed</div>
</header>

<div class="stat-strip">
  <div class="stat"><div class="count" style="color:{_RISK_COLOR[RiskLevel.GREEN]}">{counts[RiskLevel.GREEN]}</div><div class="label">Clear to proceed</div></div>
  <div class="stat"><div class="count" style="color:{_RISK_COLOR[RiskLevel.AMBER]}">{counts[RiskLevel.AMBER]}</div><div class="label">Needs review</div></div>
  <div class="stat"><div class="count" style="color:{_RISK_COLOR[RiskLevel.RED]}">{counts[RiskLevel.RED]}</div><div class="label">Reschedule recommended</div></div>
</div>

<main>
  <table>
    <thead>
      <tr>
        <th>Job</th>
        <th>Scheduled</th>
        <th>Location</th>
        <th>Type</th>
        <th>Status</th>
        <th>Reason</th>
        <th>7-day outlook</th>
      </tr>
    </thead>
    <tbody>
      {"".join(rows)}
    </tbody>
  </table>
</main>

<footer>
  Forecast data: Open-Meteo (open-meteo.com) · Thresholds are configurable per job type in job_type_profiles.json
</footer>
</body>
</html>"""


def write_html_report(path: Path, html: str) -> None:
    path.write_text(html, encoding="utf-8")
