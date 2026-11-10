"""Health is independent of configured authority, cloud clients and credentials."""

import unittest

from fastapi.testclient import TestClient

from app.main import app


class HealthTests(unittest.TestCase):
    def test_health_without_configuration(self):
        with TestClient(app) as client:
            self.assertEqual(
                client.get("/health").json(), {"status": "ok", "service": "agent-policy"}
            )
