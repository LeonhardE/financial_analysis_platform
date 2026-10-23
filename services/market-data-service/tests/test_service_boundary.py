"""A Market image contains only public market routes and no Firebase identity SDK."""

import sys
import unittest

from fastapi.testclient import TestClient

from app.main import app


class MarketBoundaryTests(unittest.TestCase):
    def test_private_resources_are_not_served_or_documented_by_market(self):
        with TestClient(app) as client:
            for path in ("/api/v1/me", "/api/v1/watchlist", "/api/v1/preferences"):
                self.assertEqual(client.get(path).status_code, 404)
            paths = client.get("/openapi.json").json()["paths"]
            self.assertIn("/api/stocks", paths)
            self.assertFalse(any(path.startswith("/api/v1/") for path in paths))
        self.assertNotIn("firebase_admin", sys.modules)
        self.assertNotIn("folioview_shared.auth", sys.modules)
