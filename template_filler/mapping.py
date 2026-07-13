from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

import openpyxl

from .models import FilledField, FillPlan, SkuRow, TemplateField, TemplateProfile, ValidationIssue


UNIT_ALIASES = {
    "cm": {"cm", "centimetre", "centimetres", "centimeter", "centimeters"},
    "kg": {"kg", "kilogram", "kilograms"},
}

MANUAL_ATTENTION_FIELDS = {"recommended_browse_nodes", "manufacturer"}
CHAIR_LISTING_REQUIRED_FIELDS = {
    "number_of_items",
    "is_assembly_required",
    "size",
    "unit_count",
    "included_components",
    "is_fragile",
    "list_price",
    "merchant_shipping_group",
}


def _is_uk_chair(profile: TemplateProfile) -> bool:
    return profile.market.casefold() == "uk" and profile.category.casefold() == "chair"


def _is_chair_listing_required(profile: TemplateProfile, field: TemplateField) -> bool:
    if not _is_uk_chair(profile) or field.base_name not in CHAIR_LISTING_REQUIRED_FIELDS:
        return False
    return field.base_name != "included_components" or field.field_id.endswith("#1.value")


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
    if _is_uk_chair(profile) and base == "fulfillment_availability" and field.field_id.endswith(".fulfillment_channel_code"):
        default = next((value for value in field.allowed_values if value.casefold() == "default"), None)
        return (True, default) if default else (False, None)
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
        attributes = product.get("attributes") or {}
        return str(product.get("mainColor") or attributes.get("Main Color") or "").strip()
    if base == "material":
        if _sequence(field.field_id, "material") != 1:
            return None
        attributes = product.get("attributes") or {}
        return str(product.get("mainMaterial") or attributes.get("Main Material") or attributes.get("Material") or "").strip()
    if base in {"item_depth_width_height", "item_display_dimensions", "item_length", "item_width"}:
        return _dimension_candidate(field, product)
    if base in {"item_weight", "item_display_weight"}:
        if field.field_id.endswith(".unit"):
            return str(product.get("assembledWeightUnit") or "kg").lower()
        return _number(product.get("assembledWeight") or product.get("weightKg"))
    return None


def _candidate(field: TemplateField, profile: TemplateProfile, product: dict[str, Any]) -> tuple[Any, str]:
    has_default, default = _business_default(field, profile, product)
    if has_default:
        return default, "business_default"
    return _giga_candidate(field, profile, product), "giga_api"


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
) -> FillPlan:
    workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=False, keep_vba=True)
    plan = FillPlan(rows_processed=len(profile.sku_rows))
    try:
        sheet = workbook[profile.sheet_name]
        for row in profile.sku_rows:
            product = products_by_sku.get(row.sku)
            if not product:
                plan.issues.append(
                    ValidationIssue(row.sku, row.row, "contribution_sku#1.value", "SKU", "error", "api_not_found", "GIGA API 未返回该 SKU")
                )
                continue

            final_values: dict[str, Any] = {}
            for field in profile.fields:
                existing = sheet.cell(row.row, field.column).value
                candidate, source = _candidate(field, profile, product)
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
                        candidate_source = "业务默认值" if source == "business_default" else "GIGA 候选值"
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
                if _is_chair_listing_required(profile, field):
                    plan.issues.append(_issue(row, field, "error", "business_required", "CHAIR UK 运营规则要求补充此字段"))
                elif field.base_name in MANUAL_ATTENTION_FIELDS and field.field_id.endswith("#1.value"):
                    plan.issues.append(_issue(row, field, "warning", "manual_attention", "按运营规则保持空白，需要人工补充或确认"))
                elif field.requirement == "required":
                    plan.issues.append(_issue(row, field, "error", "missing_required", "Amazon 必填字段无法从 GIGA 数据自动填写"))
        return plan
    finally:
        workbook.close()
