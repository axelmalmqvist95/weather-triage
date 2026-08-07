from weather_triage.models import Coordinates
from weather_triage.weather_client import OpenMeteoClient


class TestOpenMeteoClientParams:
    """Guards against regressions in the exact query parameters sent to
    Open-Meteo — e.g. the windspeed_unit bug where wind came back in km/h
    instead of m/s and silently inflated every risk assessment (76/80 jobs
    were incorrectly flagged for reschedule before this was caught).
    """

    def test_requests_wind_speed_in_meters_per_second(self):
        captured = {}

        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    "daily": {
                        "time": ["2026-08-10"],
                        "windspeed_10m_max": [5.0],
                        "precipitation_sum": [0.0],
                        "temperature_2m_max": [20.0],
                        "temperature_2m_min": [10.0],
                    }
                }

        class FakeSession:
            def get(self, url, params, timeout):
                captured["params"] = params
                return FakeResponse()

        client = OpenMeteoClient(session=FakeSession())
        client.get_daily_forecast(Coordinates(latitude=55.6, longitude=13.0))

        assert captured["params"]["windspeed_unit"] == "ms"
