"""Configuration neither serves stock data nor imports Market or User modules."""

import sys
import unittest

from fastapi.testclient import TestClient

from app.main import app


class ConfigBoundaryTests(unittest.TestCase):
    def test_config_has_its_own_health_and_only_preference_routes(self):
        with TestClient(app) as client:
            self.assertEqual(client.get("/health").json(), {"status": "ok", "service": "config"})
            for path in ("/api/v1/me", "/api/v1/watchlist", "/api/stocks"):
                response = client.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(client.get("/api/v1/preferences").status_code, 401)
            self.assertEqual(
                set(client.get("/openapi.json").json()["paths"]),
                {"/health", "/api/v1/preferences"},
            )
        for module in ("yfinance", "app.market_data", "app.watchlist"):
            self.assertNotIn(module, sys.modules)
