from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

import openpyxl

from .models import FilledField, FillPlan, SkuRow, TemplateField, TemplateProfile, ValidationIssue
from .policy import POLICY_ACTION_DEFAULT, POLICY_ACTION_REMINDER, POLICY_ACTION_REQUIRED, TemplatePolicy, initial_policy_rules
from .variants import VariantRow, attribute_value


UNIT_ALIASES = {
    "cm": {"cm", "centimetre", "centimetres", "centimeter", "centimeters"},
    "kg": {"kg", "kilogram", "kilograms"},
}

MANUAL_ATTENTION_FIELDS = {"recommended_browse_nodes", "manufacturer"}
RELATIONSHIP_FIELDS = {"contribution_sku", "parentage_level", "child_parent_sku_relationship", "variation_theme"}
PARENT_SAFE_BASE_NAMES = {
    "product_type", "item_name", "model_number", "part_number", "product_description", "bullet_point",
    "brand", "country_of_origin", "supplier_declared_dg_hz_regulation",
}


def _number(value: Any) -> int | float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return int(parsed) if parsed.is_integer() else parsed


def _plain_description(product: dict[str, Any]) -> str:
    raw = str(product.get("description") or "")
    raw = re.sub(r"<img\b[^>]*>", " ", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<br\s*/?>|</p>|</div>|</li>", "\n", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<[^>]+>", " ", raw)
    cleaned = re.sub(r"[ \t]+", " ", html.unescape(raw))
    cleaned = re.sub(r"\n\s*\n+", "\n", cleaned).strip()
    if cleaned:
        return cleaned
    return "\n".join(str(item).strip() for item in (product.get("characteristics") or []) if str(item).strip())


def _sequence(field_id: str, base_name: str) -> int:
    pattern = rf"{re.escape(base_name)}.*?#(\d+)\.value$"
    match = re.search(pattern, field_id)
    return int(match.group(1)) if match else 1


def _dimension_candidate(field: TemplateField, product: dict[str, Any]) -> Any:
    field_id = field.field_id
    base = field.base_name
    length = _number(product.get("assembledLength"))
    width = _number(product.get("assembledWidth"))
    height = _number(product.get("assembledHeight"))
    unit = str(product.get("assembledLengthUnit") or "cm").lower()

    if base == "item_depth_width_height":
        if ".depth.value" in field_id:
            return width
        if ".width.value" in field_id:
            return length
        if ".height.value" in field_id:
            return height
        if field_id.endswith(".unit"):
            return unit
    if base == "item_display_dimensions":
        if ".length.value" in field_id:
            return length
        if ".width.value" in field_id:
            return width
        if ".height.value" in field_id:
            return height
        if any(part in field_id for part in (".length.unit", ".width.unit", ".height.unit")):
            return unit
    if base == "item_length":
        return unit if field_id.endswith(".unit") else length
    if base == "item_width":
        return unit if field_id.endswith(".unit") else width
    return None


def _business_default(field: TemplateField, profile: TemplateProfile, product: dict[str, Any]) -> tuple[bool, Any]:
    base = field.base_name
    if base == "brand":
        return True, "GENERIC"
    if base == "amzn1.volt.ca.product_id_type":
        return True, "GTIN Exempt"
    if base == "amzn1.volt.ca.product_id_value":
        return True, None
    if base == "country_of_origin":
        return True, "China"
    if base == "condition_type":
        return True, "New"
    if base in {"batteries_required", "batteries_included"}:
        return True, "No"
    if base == "supplier_declared_dg_hz_regulation":
        return True, "Not Applicable"
    if base == "fulfillment_availability" and field.field_id.endswith(".quantity"):
        available = product.get("skuAvailable")
        if available is True:
            return True, 5
        if available is False:
            return True, 0
    return False, None


def _giga_candidate(field: TemplateField, profile: TemplateProfile, product: dict[str, Any]) -> Any:
    base = field.base_name
    if base == "product_type":
        return profile.category
    if base == "item_name":
        return str(product.get("productName") or "").strip()
    if base in {"model_number", "part_number"}:
        return str(product.get("mpn") or "").strip()
    if base == "product_description":
        return _plain_description(product)
    if base == "bullet_point":
        bullets = product.get("characteristics") or []
        index = _sequence(field.field_id, "bullet_point") - 1
        return str(bullets[index]).strip() if index < len(bullets) else ""
    if base == "color":
        return attribute_value(product, "COLOR")
    if base == "material":
        if _sequence(field.field_id, "material") != 1:
            return None
        return attribute_value(product, "MATERIAL")
    if base == "fabric_type":
        return attribute_value(product, "FABRIC_TYPE")
    if base in {"frame_material", "frame_material_type"} or (base == "frame" and "material" in field.field_id):
        return attribute_value(product, "FRAME_MATERIAL_TYPE") or attribute_value(product, "FRAME_MATERIAL")
    if base == "seat" and "material_type" in field.field_id:
        return attribute_value(product, "SEAT_MATERIAL_TYPE")
    if base == "size":
        return attribute_value(product, "SIZE")
    if base in {"item_depth_width_height", "item_display_dimensions", "item_length", "item_width"}:
        return _dimension_candidate(field, product)
    if base in {"item_weight", "item_display_weight"}:
        if field.field_id.endswith(".unit"):
            return str(product.get("assembledWeightUnit") or "kg").lower()
        return _number(product.get("assembledWeight") or product.get("weightKg"))
    return None


def _candidate(field: TemplateField, profile: TemplateProfile, product: dict[str, Any], policy_rules, role: str = "seed") -> tuple[Any, str]:
    has_default, default = _business_default(field, profile, product)
    if has_default:
        return default, "business_default"
    rule = policy_rules.get(field.field_id)
    if rule is not None and rule.action == POLICY_ACTION_DEFAULT and _rule_applies(rule, role):
        return rule.value, "template_policy"
    return _giga_candidate(field, profile, product), "giga_api"


def _relationship_candidate(field: TemplateField, row: VariantRow) -> tuple[Any, str] | None:
    if field.base_name == "contribution_sku":
        return row.sku, "variant_relationship"
    if field.base_name == "parentage_level" and row.role in {"parent", "child"}:
        return ("Parent" if row.role == "parent" else "Child"), "variant_relationship"
    if field.base_name == "child_parent_sku_relationship" and row.role == "child":
        return row.parent_sku, "variant_relationship"
    if field.base_name == "variation_theme" and row.role in {"parent", "child"}:
        return row.variation_theme, "variant_relationship"
    return None


def _rule_applies(rule, role: str) -> bool:
    if role == "seed":
        return True
    if rule.scope == "all":
        return True
    return rule.scope == role


def _coerce_dropdown(field: TemplateField, value: Any, *, allow_unresolved_default: bool = False) -> Any:
    if value in (None, "") or not field.is_dropdown:
        return value
    if not field.allowed_values:
        return value if allow_unresolved_default else None
    text = str(value).strip()
    exact = next((allowed for allowed in field.allowed_values if allowed.casefold() == text.casefold()), None)
    if exact is not None:
        return exact
    aliases = UNIT_ALIASES.get(text.casefold())
    if aliases:
        return next((allowed for allowed in field.allowed_values if allowed.casefold() in aliases), None)
    return None


def _issue(row: SkuRow, field: TemplateField, severity: str, status: str, message: str) -> ValidationIssue:
    return ValidationIssue(
        sku=row.sku,
        row=row.row,
        field_id=field.field_id,
        label=field.label,
        severity=severity,
        status=status,
        message=message,
        allowed_values=field.allowed_values[:100],
    )


def build_fill_plan(
    profile: TemplateProfile,
    workbook_path: str | Path,
    products_by_sku: dict[str, dict[str, Any]],
    *,
    policy: TemplatePolicy | None = None,
    policy_configured: bool = True,
    rows: list[VariantRow] | None = None,
) -> FillPlan:
    workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=False, keep_vba=True)
    active_rows = rows or [VariantRow(row.row, row.row, row.sku, "seed") for row in profile.sku_rows]
    plan = FillPlan(rows_processed=sum(row.role != "omit" for row in active_rows))
    policy_rules = policy.rules if policy is not None else (initial_policy_rules(profile) if policy_configured else {})
    try:
        sheet = workbook[profile.sheet_name]
        for output in active_rows:
            if output.role == "omit":
                continue
            row = SkuRow(output.output_row, output.sku)
            source_row = output.source_row
            if not policy_configured:
                plan.issues.append(
                    ValidationIssue(
                        row.sku, row.row, "__template_policy__", "Template Policy", "error", "policy_unconfigured",
                        "该平台/站点/类目尚未配置运营策略，请在规则编辑器中保存后再上传",
                    )
                )
            product = output.product or products_by_sku.get(row.sku)
            if not product:
                plan.issues.append(
                    ValidationIssue(row.sku, row.row, "contribution_sku#1.value", "SKU", "error", "api_not_found", "GIGA API 未返回该 SKU")
                )
                continue

            final_values: dict[str, Any] = {}
            for field in profile.fields:
                relationship = _relationship_candidate(field, output)
                existing = sheet.cell(source_row, field.column).value if (
                    output.role in {"seed", "parent"}
                    and relationship is None
                    and not (output.role == "parent" and field.base_name in RELATIONSHIP_FIELDS)
                ) else None
                if relationship is not None:
                    candidate, source = relationship
                elif output.role == "parent" and field.base_name not in PARENT_SAFE_BASE_NAMES:
                    candidate, source = None, "parent_excluded"
                else:
                    candidate, source = _candidate(field, profile, product, policy_rules, output.role)
                if existing not in (None, ""):
                    final_values[field.field_id] = existing
                    if candidate not in (None, "") and field.base_name != "contribution_sku":
                        plan.issues.append(_issue(row, field, "info", "preserved", "保留运营已填写值，未被 GIGA 数据覆盖"))
                    if field.is_dropdown and field.allowed_values and not any(
                        str(existing).strip().casefold() == allowed.casefold() for allowed in field.allowed_values
                    ):
                        plan.issues.append(_issue(row, field, "error", "invalid_existing_value", "现有值不在模板允许值中"))
                    continue

                if candidate not in (None, ""):
                    value = _coerce_dropdown(
                        field,
                        candidate,
                        allow_unresolved_default=source == "business_default",
                    )
                    if field.is_dropdown and value in (None, ""):
                        candidate_source = {"business_default": "业务默认值", "template_policy": "模板策略默认值"}.get(source, "GIGA 候选值")
                        plan.issues.append(_issue(row, field, "warning", "dropdown_required", f"{candidate_source} {candidate!r} 不在模板允许值中"))
                    else:
                        plan.changes[(row.row, field.column)] = value
                        final_values[field.field_id] = value
                        plan.filled_fields.append(FilledField(
                            sku=row.sku,
                            row=row.row,
                            field_id=field.field_id,
                            label=field.label,
                            value=value,
                            source=source,
                        ))

            for field in profile.fields:
                if final_values.get(field.field_id) not in (None, ""):
                    continue
                if output.role == "parent" and field.base_name not in PARENT_SAFE_BASE_NAMES | RELATIONSHIP_FIELDS:
                    continue
                rule = policy_rules.get(field.field_id)
                if rule is not None and _rule_applies(rule, output.role) and rule.action == POLICY_ACTION_REQUIRED:
                    plan.issues.append(_issue(row, field, "error", "business_required", "当前模板运营策略要求补充此字段"))
                elif rule is not None and _rule_applies(rule, output.role) and rule.action == POLICY_ACTION_REMINDER:
                    plan.issues.append(_issue(row, field, "warning", "manual_attention", "当前模板运营策略要求人工确认"))
                elif rule is None and field.base_name in MANUAL_ATTENTION_FIELDS and field.field_id.endswith("#1.value"):
                    plan.issues.append(_issue(row, field, "warning", "manual_attention", "按运营规则保持空白，需要人工补充或确认"))
                elif field.requirement == "required":
                    plan.issues.append(_issue(row, field, "error", "missing_required", "Amazon 必填字段无法从 GIGA 数据自动填写"))
        return plan
    finally:
        workbook.close()
