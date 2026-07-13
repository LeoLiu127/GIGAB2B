from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .models import TemplateField, TemplateProfile


POLICY_ACTION_REQUIRED = "required"
POLICY_ACTION_REMINDER = "reminder"
POLICY_ACTION_DEFAULT = "default"
POLICY_ACTION_IGNORE = "ignore"
POLICY_ACTIONS = {POLICY_ACTION_REQUIRED, POLICY_ACTION_REMINDER, POLICY_ACTION_DEFAULT, POLICY_ACTION_IGNORE}
POLICY_SCOPE_PARENT = "parent"
POLICY_SCOPE_CHILD = "child"
POLICY_SCOPE_ALL = "all"
POLICY_SCOPES = {POLICY_SCOPE_PARENT, POLICY_SCOPE_CHILD, POLICY_SCOPE_ALL}

CHAIR_REQUIRED_BASE_NAMES = {
    "number_of_items",
    "is_assembly_required",
    "size",
    "unit_count",
    "included_components",
    "is_fragile",
    "list_price",
    "merchant_shipping_group",
}


@dataclass(frozen=True)
class PolicyRule:
    action: str
    value: str | None = None
    scope: str = POLICY_SCOPE_CHILD

    def to_dict(self) -> dict[str, str]:
        result = {"action": self.action, "scope": self.scope}
        if self.value is not None:
            result["value"] = self.value
        return result


@dataclass(frozen=True)
class TemplatePolicy:
    platform: str
    market: str
    category: str
    version: int
    fingerprint: str
    schema: dict[str, dict[str, Any]]
    rules: dict[str, PolicyRule]

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "market": self.market,
            "category": self.category,
            "version": self.version,
            "fingerprint": self.fingerprint,
            "rules": {field_id: rule.to_dict() for field_id, rule in self.rules.items()},
        }


def template_schema(profile: TemplateProfile) -> dict[str, dict[str, Any]]:
    return {
        field.field_id: {
            "requirement": field.requirement,
            "allowed_values": sorted(set(field.allowed_values), key=str.casefold),
        }
        for field in profile.fields
    }


def template_fingerprint(profile: TemplateProfile) -> str:
    payload = json.dumps(template_schema(profile), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _is_uk_chair(profile: TemplateProfile) -> bool:
    return profile.platform.casefold() == "amazon" and profile.market.casefold() == "uk" and profile.category.casefold() == "chair"


def _is_chair_required(field: TemplateField) -> bool:
    return field.base_name in CHAIR_REQUIRED_BASE_NAMES and (
        field.base_name != "included_components" or field.field_id.endswith("#1.value")
    )


def initial_policy_rules(profile: TemplateProfile) -> dict[str, PolicyRule]:
    """Seed only the explicitly approved UK CHAIR operating policy."""
    if not _is_uk_chair(profile):
        return {}
    rules = {
        field.field_id: PolicyRule(POLICY_ACTION_REQUIRED)
        for field in profile.fields
        if _is_chair_required(field)
    }
    for field in profile.fields:
        if field.base_name == "fulfillment_availability" and field.field_id.endswith(".fulfillment_channel_code"):
            default = next((item for item in field.allowed_values if item.casefold() == "default"), None)
            if default:
                rules[field.field_id] = PolicyRule(POLICY_ACTION_DEFAULT, default)
    return rules


def _normalize_rules(profile: TemplateProfile, raw_rules: Mapping[str, PolicyRule | Mapping[str, Any]]) -> dict[str, PolicyRule]:
    fields = {field.field_id: field for field in profile.fields}
    result: dict[str, PolicyRule] = {}
    for field_id, raw_rule in raw_rules.items():
        if field_id not in fields:
            raise ValueError(f"策略字段不在当前模板中: {field_id}")
        if isinstance(raw_rule, PolicyRule):
            rule = raw_rule
        else:
            rule = PolicyRule(
                str(raw_rule.get("action") or "").strip(),
                str(raw_rule.get("value")).strip() if raw_rule.get("value") is not None else None,
                str(raw_rule.get("scope") or POLICY_SCOPE_CHILD).strip(),
            )
        if rule.action not in POLICY_ACTIONS:
            raise ValueError(f"不支持的策略动作: {rule.action}")
        if rule.scope not in POLICY_SCOPES:
            raise ValueError(f"不支持的策略适用对象: {rule.scope}")
        if rule.action == POLICY_ACTION_DEFAULT:
            if rule.value in (None, ""):
                raise ValueError(f"默认值不能为空: {field_id}")
            field = fields[field_id]
            if field.is_dropdown and field.allowed_values and not any(rule.value.casefold() == item.casefold() for item in field.allowed_values):
                raise ValueError(f"默认值不在模板允许值中: {field_id}")
        elif rule.value not in (None, ""):
            raise ValueError(f"仅 default 动作可以设置值: {field_id}")
        result[field_id] = rule
    return result


def schema_drift(saved_schema: Mapping[str, Mapping[str, Any]], profile: TemplateProfile) -> list[dict[str, Any]]:
    current_schema = template_schema(profile)
    changes: list[dict[str, Any]] = []
    for field_id in sorted(set(current_schema) - set(saved_schema)):
        changes.append({"kind": "field_added", "field_id": field_id})
    for field_id in sorted(set(saved_schema) - set(current_schema)):
        changes.append({"kind": "field_removed", "field_id": field_id})
    for field_id in sorted(set(saved_schema) & set(current_schema)):
        before, after = saved_schema[field_id], current_schema[field_id]
        if before.get("requirement") != after.get("requirement"):
            changes.append({"kind": "requirement_changed", "field_id": field_id, "before": before.get("requirement"), "after": after.get("requirement")})
        if before.get("allowed_values", []) != after.get("allowed_values", []):
            changes.append({"kind": "allowed_values_changed", "field_id": field_id})
    return changes


class PolicyStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        return sqlite3.connect(self.path)

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS template_policies (
                    platform TEXT NOT NULL,
                    market TEXT NOT NULL,
                    category TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    fingerprint TEXT NOT NULL,
                    schema_json TEXT NOT NULL,
                    rules_json TEXT NOT NULL,
                    PRIMARY KEY (platform, market, category)
                )
                """
            )
            connection.commit()

    @staticmethod
    def _key(profile: TemplateProfile) -> tuple[str, str, str]:
        return profile.platform.casefold(), profile.market.casefold(), profile.category.casefold()

    def lookup(self, profile: TemplateProfile) -> tuple[TemplatePolicy | None, list[dict[str, Any]]]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT platform, market, category, version, fingerprint, schema_json, rules_json FROM template_policies WHERE platform = ? AND market = ? AND category = ?",
                self._key(profile),
            ).fetchone()
        if row is None:
            return None, []
        raw_rules = json.loads(row[6])
        policy = TemplatePolicy(
            platform=row[0], market=row[1], category=row[2], version=int(row[3]), fingerprint=row[4],
            schema=json.loads(row[5]),
            rules={field_id: PolicyRule(**rule) for field_id, rule in raw_rules.items()},
        )
        return policy, schema_drift(policy.schema, profile)

    def save(self, profile: TemplateProfile, raw_rules: Mapping[str, PolicyRule | Mapping[str, Any]]) -> TemplatePolicy:
        rules = _normalize_rules(profile, raw_rules)
        existing, _ = self.lookup(profile)
        policy = TemplatePolicy(
            platform=profile.platform.casefold(), market=profile.market.casefold(), category=profile.category.casefold(),
            version=(existing.version + 1) if existing else 1,
            fingerprint=template_fingerprint(profile), schema=template_schema(profile), rules=rules,
        )
        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO template_policies (platform, market, category, version, fingerprint, schema_json, rules_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, market, category) DO UPDATE SET
                    version = excluded.version, fingerprint = excluded.fingerprint,
                    schema_json = excluded.schema_json, rules_json = excluded.rules_json
                """,
                (
                    policy.platform, policy.market, policy.category, policy.version, policy.fingerprint,
                    json.dumps(policy.schema, ensure_ascii=False, sort_keys=True),
                    json.dumps({field_id: rule.to_dict() for field_id, rule in policy.rules.items()}, ensure_ascii=False, sort_keys=True),
                ),
            )
            connection.commit()
        return policy

    def ensure_initial_policy(self, profile: TemplateProfile) -> TemplatePolicy | None:
        policy, _ = self.lookup(profile)
        if policy is not None:
            return policy
        if profile.platform.casefold() == "amazon" and profile.market.casefold() == "uk" and profile.category.casefold() in {"chair", "cabinet"}:
            return self.save(profile, initial_policy_rules(profile))
        return None
