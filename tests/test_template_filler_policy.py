from __future__ import annotations

import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from template_filler.policy import (
    POLICY_ACTION_DEFAULT,
    POLICY_ACTION_REQUIRED,
    PolicyStore,
    PolicyRule,
    initial_policy_rules,
    template_fingerprint,
)
from template_filler.mapping import build_fill_plan
from template_filler.parser import parse_amazon_template


FIXTURE_DIR = Path(os.environ.get("GIGAB2B_TEMPLATE_FIXTURE_DIR", "input"))


class TemplatePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not FIXTURE_DIR.exists():
            raise unittest.SkipTest("real Amazon template fixtures are not available")

    def test_initial_rules_are_scoped_to_uk_chair_and_cabinet_gets_empty_baseline(self):
        chair = parse_amazon_template(FIXTURE_DIR / "CHAIR-UK-1SKU.xlsm")
        cabinet = parse_amazon_template(FIXTURE_DIR / "CABINET-UK-1SKU.xlsm")

        chair_rules = initial_policy_rules(chair)
        channel = next(field for field in chair.fields if field.field_id.endswith(".fulfillment_channel_code"))
        self.assertEqual(chair_rules[channel.field_id].action, POLICY_ACTION_DEFAULT)
        self.assertEqual(chair_rules[channel.field_id].value, "DEFAULT")
        self.assertTrue(any(rule.action == POLICY_ACTION_REQUIRED for rule in chair_rules.values()))
        self.assertEqual(initial_policy_rules(cabinet), {})

    def test_store_reuses_policy_by_platform_market_and_category_and_reports_schema_drift(self):
        profile = parse_amazon_template(FIXTURE_DIR / "CHAIR-UK-1SKU.xlsm")
        material = profile.field_by_base_name("material")
        changed_fields = tuple(
            replace(field, allowed_values=field.allowed_values + ("Chenille",)) if field.field_id == material.field_id else field
            for field in profile.fields
        )
        changed_profile = replace(profile, fields=changed_fields)

        with tempfile.TemporaryDirectory() as temp_dir:
            store = PolicyStore(Path(temp_dir) / "policies.sqlite3")
            saved = store.save(profile, initial_policy_rules(profile))
            loaded, drift = store.lookup(changed_profile)

        self.assertEqual(loaded.version, saved.version)
        self.assertNotEqual(template_fingerprint(profile), template_fingerprint(changed_profile))
        self.assertTrue(any(item["kind"] == "allowed_values_changed" and item["field_id"] == material.field_id for item in drift))

    def test_store_rejects_default_not_available_in_template_dropdown(self):
        profile = parse_amazon_template(FIXTURE_DIR / "CHAIR-UK-1SKU.xlsm")
        material = profile.field_by_base_name("material")
        with tempfile.TemporaryDirectory() as temp_dir:
            store = PolicyStore(Path(temp_dir) / "policies.sqlite3")
            with self.assertRaisesRegex(ValueError, "允许值"):
                store.save(profile, {material.field_id: {"action": POLICY_ACTION_DEFAULT, "value": "Chenille"}})

    def test_plan_uses_policy_rules_and_blocks_an_unconfigured_new_category(self):
        profile = parse_amazon_template(FIXTURE_DIR / "CHAIR-UK-1SKU.xlsm")
        product = {"sku": "W5807S00002"}
        assembly = profile.field_by_base_name("is_assembly_required")
        with tempfile.TemporaryDirectory() as temp_dir:
            store = PolicyStore(Path(temp_dir) / "policies.sqlite3")
            policy = store.save(profile, {assembly.field_id: PolicyRule(POLICY_ACTION_DEFAULT, "No")})
            plan = build_fill_plan(profile, profile.source_path, {product["sku"]: product}, policy=policy)

        self.assertEqual(plan.changes[(8, assembly.column)], "No")
        self.assertTrue(any(item.source == "template_policy" and item.field_id == assembly.field_id for item in plan.filled_fields))

        unconfigured = replace(profile, category="NEW_CATEGORY")
        blocked = build_fill_plan(unconfigured, profile.source_path, {product["sku"]: product}, policy=None, policy_configured=False)
        self.assertTrue(any(issue.status == "policy_unconfigured" for issue in blocked.issues))
