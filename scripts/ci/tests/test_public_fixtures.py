"""Keep public deployment fixtures synthetic without removing regression evidence."""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "infra/gcp/terraform/bootstrap/tests/fixtures"
REPORTS = (
    "infra/gcp/terraform/compatibility/live-results-2026-10-23.json",
    "infra/gcp/terraform/compatibility/live-ownership-results-2026-10-23.json",
    "infra/gcp/terraform/envs/prod/market/adoption-readonly-results-2026-10-23.json",
)


def require_synthetic_references(text):
    """Check cloud reference syntax, not a denylist containing the operator's IDs."""
    patterns = (
        r"projects/([a-z0-9-]+)/",
        r"@([a-z0-9-]+)\.iam\.gserviceaccount\.com",
        r"-docker\.pkg\.dev/([a-z0-9-]+)/",
    )
    for pattern in patterns:
        for project in re.findall(pattern, text):
            if project not in {"demo-folio-alpha", "111222333444"}:
                raise ValueError("Public fixture contains a non-synthetic cloud reference.")
    for origin in re.findall(r"https://[a-z0-9.-]+\.run\.app", text):
        if not re.fullmatch(
            r"https://[a-z][a-z0-9-]*-111222333444\.northamerica-northeast2\.run\.app",
            origin,
        ):
            raise ValueError("Public fixture contains a non-synthetic cloud reference.")
    for bucket in re.findall(r"gs://([a-z0-9._-]+)", text):
        if not bucket.startswith("demo-folio-alpha-"):
            raise ValueError("Public fixture contains a non-synthetic cloud reference.")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, list):
            pending.extend(item)
        elif isinstance(item, dict):
            for key, content in item.items():
                expected = {
                    "project_id": "demo-folio-alpha",
                    "project_number": "111222333444",
                }
                if key == "project":
                    expected[key] = (
                        {"id": "demo-folio-alpha", "number": "111222333444"}
                        if isinstance(content, dict)
                        else "demo-folio-alpha"
                    )
                if key in expected and content != expected[key]:
                    raise ValueError("Public fixture contains a non-synthetic cloud reference.")
                pending.append(content)


class PublicFixtureTests(unittest.TestCase):
    def test_bootstrap_instances_are_synthetic_and_still_use_canonical_transport(self):
        documents = json.loads((FIXTURES / "deployment-configs.json").read_text())
        for target, encoded in documents.items():
            with self.subTest(target=target):
                value = json.loads(encoded)
                self.assertEqual(value["target"], target)
                self.assertEqual(
                    value["project"],
                    {"id": "demo-folio-alpha", "number": "111222333444"},
                )
                self.assertEqual(
                    value["source"]["repositoryUrl"],
                    "https://github.com/example/folioview.git",
                )
                self.assertEqual(encoded, json.dumps(value, sort_keys=True, separators=(",", ":")))
                self.assertLessEqual(len(encoded.encode()), 4000)
                require_synthetic_references(encoded)
        trust = (FIXTURES / "portfolio-trust.json").read_text()
        require_synthetic_references(trust)

    def test_historical_reports_disclose_pseudonymization_and_keep_outcomes(self):
        for name in REPORTS:
            with self.subTest(path=name):
                text = (ROOT / name).read_text()
                value = json.loads(text)
                self.assertEqual(value["publication"]["kind"], "pseudonymized-regression-fixture")
                self.assertIn("status", value)
                require_synthetic_references(text)

    def test_reference_guard_rejects_unreviewed_cloud_identifiers_without_echoing_them(
        self,
    ):
        for pattern in (
            "projects/unauthorized-fixture/locations/us-central1",
            "runtime@unauthorized-fixture.iam.gserviceaccount.com",
            "us-central1-docker.pkg.dev/unauthorized-fixture/images/app",
            "https://service-987654321987.us-central1.run.app",
            "gs://unauthorized-fixture-state/object",
            '{"project_id":"unauthorized-fixture"}',
            '{"nested":{"project":{"id":"demo-folio-alpha","number":"987654321987"}}}',
        ):
            with self.subTest(reference_kind=pattern.split("/")[0]):
                with self.assertRaisesRegex(ValueError, "non-synthetic cloud reference"):
                    require_synthetic_references(pattern)


if __name__ == "__main__":
    unittest.main()
