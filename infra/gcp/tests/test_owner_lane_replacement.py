"""A reviewed one-slot VM transition must not become a generic destroy permission."""

import copy
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "replacement_lane", Path(__file__).parents[1] / "owner_lane.py"
)
lane = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lane)


class ReplacementTests(unittest.TestCase):
    def setUp(self):
        self.contract = {
            "projectId": "demo-executor-alpha",
            "inputs": {
                "deployment": {
                    "instance_name": "synthetic-executor",
                    "zone": "northamerica-northeast2-b",
                },
                "instance_protection_enabled": False,
            },
            "replacementReview": {"expectedInstanceId": "123456789", "stateGeneration": "5"},
        }
        self.adopted = {
            "controllers": [],
            "replacement": {
                "instanceAddress": "google_compute_instance.executor[0]",
                "launchAddress": "terraform_data.launch[0]",
            },
        }
        value = {
            "project": "demo-executor-alpha",
            "name": "synthetic-executor",
            "zone": "northamerica-northeast2-b",
            "deletion_protection": False,
            "machine_type": "n2d-standard-2",
        }
        self.plan = {
            "terraform_version": "1.16.7",
            "resource_changes": [
                {
                    "address": "google_compute_instance.executor[0]",
                    "mode": "managed",
                    "type": "google_compute_instance",
                    "provider_name": "registry.terraform.io/hashicorp/google",
                    "change": {
                        "actions": ["delete", "create"],
                        "before": {**value, "instance_id": "123456789"},
                        "after": value,
                    },
                },
                {
                    "address": "terraform_data.launch[0]",
                    "mode": "managed",
                    "type": "terraform_data",
                    "provider_name": "terraform.io/builtin/terraform",
                    "change": {"actions": ["delete", "create"], "before": {}, "after": {}},
                },
            ],
        }

    def check(self):
        return lane.summary(
            self.plan,
            "1.16.7",
            self.contract,
            self.adopted,
            Path("/source/target"),
            Path("/source"),
        )

    def test_only_explicit_same_slot_replace_is_permitted(self):
        self.assertEqual(self.check().count("replace reviewed fixed instance slot"), 2)

    def test_no_review_or_no_source_adoption_cannot_replace(self):
        for mutate in [
            lambda: self.contract.pop("replacementReview"),
            lambda: self.adopted.update(replacement=None),
        ]:
            self.setUp()
            mutate()
            with self.assertRaises(ValueError):
                self.check()

    def test_old_id_foreign_project_new_name_zone_or_size_are_refused(self):
        for side, key, value in [
            ("before", "instance_id", "987654321"),
            ("before", "project", "foreign-alpha"),
            ("after", "project", "foreign-alpha"),
            ("after", "name", "second-slot"),
            ("after", "zone", "northamerica-northeast2-a"),
            ("after", "machine_type", "n2d-standard-4"),
        ]:
            with self.subTest(side=side, key=key):
                self.setUp()
                self.plan["resource_changes"][0]["change"][side][key] = value
                with self.assertRaises(ValueError):
                    self.check()

    def test_protection_off_is_a_prior_separate_step(self):
        for side in ["before", "after"]:
            self.setUp()
            self.plan["resource_changes"][0]["change"][side]["deletion_protection"] = True
            with self.assertRaises(ValueError):
                self.check()
        self.setUp()
        self.contract["inputs"]["instance_protection_enabled"] = True
        with self.assertRaises(ValueError):
            self.check()

    def test_delete_only_create_before_destroy_and_unused_review_fail(self):
        for actions in [["delete"], ["create", "delete"], ["no-op"], ["update"]]:
            self.setUp()
            self.plan["resource_changes"][0]["change"]["actions"] = actions
            with self.assertRaises(ValueError):
                self.check()

    def test_other_bucket_delete_or_second_vm_is_still_refused(self):
        for extra in [
            {
                "address": "google_storage_bucket.state",
                "type": "google_storage_bucket",
                "change": {"actions": ["delete"]},
            },
            {
                "address": "google_compute_instance.executor[1]",
                "type": "google_compute_instance",
                "mode": "managed",
                "change": {"actions": ["create"]},
            },
        ]:
            self.setUp()
            self.plan["resource_changes"].append(copy.deepcopy(extra))
            with self.assertRaises(ValueError):
                self.check()

    def test_launch_alone_or_wrong_provider_is_not_a_replacement(self):
        self.plan["resource_changes"].pop(0)
        with self.assertRaises(ValueError):
            self.check()
        self.setUp()
        self.plan["resource_changes"][1]["provider_name"] = "registry.terraform.io/foreign/provider"
        with self.assertRaises(ValueError):
            self.check()


if __name__ == "__main__":
    unittest.main()
