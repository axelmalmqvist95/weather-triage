"""Client for the Open-Meteo forecast API.

Open-Meteo was chosen deliberately over region-locked providers (e.g. SMHI,
which only covers Scandinavia): it is free, requires no API key, has no
request quota for non-commercial use, and returns global coverage — which
matters for a tool meant to generalise beyond a single country's market.

API reference: https://open-meteo.com/en/docs
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

import requests

from weather_triage.models import Coordinates, DailyForecast

logger = logging.getLogger(__name__)

_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_DAILY_FIELDS = (
    "temperature_2m_max,temperature_2m_min,"
    "precipitation_sum,windspeed_10m_max"
)


class WeatherClientError(RuntimeError):
    """Raised when the forecast API cannot be reached or returns bad data."""


class OpenMeteoClient:
    """Thin, dependency-injectable wrapper around the Open-Meteo REST API."""

    def __init__(self, session: requests.Session | None = None, timeout_seconds: float = 10.0) -> None:
        self._session = session or requests.Session()
        self._timeout_seconds = timeout_seconds

    def get_daily_forecast(
        self,
        location: Coordinates,
        forecast_days: int = 7,
    ) -> dict[date, DailyForecast]:
        """Fetch a multi-day forecast and index it by calendar date.

        Raises:
            WeatherClientError: on network failure, non-200 response, or a
                response payload missing the fields this system depends on.
        """
        params = {
            "latitude": location.latitude,
            "longitude": location.longitude,
            "daily": _DAILY_FIELDS,
            "timezone": "auto",
            "forecast_days": forecast_days,
            "windspeed_unit": "ms",
        }

        try:
            response = self._session.get(_FORECAST_URL, params=params, timeout=self._timeout_seconds)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise WeatherClientError(f"forecast request failed: {exc}") from exc

        return self._parse_daily_payload(response.json())

    @staticmethod
    def _parse_daily_payload(payload: dict[str, Any]) -> dict[date, DailyForecast]:
        try:
            daily = payload["daily"]
            dates = daily["time"]
            wind = daily["windspeed_10m_max"]
            precipitation = daily["precipitation_sum"]
            temp_max = daily["temperature_2m_max"]
            temp_min = daily["temperature_2m_min"]
        except KeyError as exc:
            raise WeatherClientError(f"unexpected response shape, missing key: {exc}") from exc

        forecasts: dict[date, DailyForecast] = {}
        for i, day_str in enumerate(dates):
            day = datetime.strptime(day_str, "%Y-%m-%d").date()
            forecasts[day] = DailyForecast(
                forecast_date=day,
                max_wind_speed_ms=float(wind[i]),
                precipitation_mm=float(precipitation[i]),
                min_temperature_c=float(temp_min[i]),
                max_temperature_c=float(temp_max[i]),
            )
        return forecasts
