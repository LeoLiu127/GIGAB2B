from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

import openpyxl

from .models import FillPlan, SkuRow, TemplateField, TemplateProfile, ValidationIssue


UNIT_ALIASES = {
    "cm": {"cm", "centimetre", "centimetres", "centimeter", "centimeters"},
    "kg": {"kg", "kilogram", "kilograms"},
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


def _brand(product: dict[str, Any]) -> str:
    info = product.get("brandInfo") or {}
    return str(info.get("brandName") or product.get("brand") or "").strip()


def _valid_gtin(value: Any) -> str:
    digits = str(value or "").strip()
    if not digits.isdigit() or len(digits) not in {8, 12, 13, 14}:
        return ""
    body = digits[:-1]
    total = 0
    for index, digit in enumerate(reversed(body)):
        total += int(digit) * (3 if index % 2 == 0 else 1)
    check = (10 - total % 10) % 10
    return digits if check == int(digits[-1]) else ""


def _gtin_type(gtin: str) -> str:
    return {8: "EAN", 12: "UPC", 13: "EAN", 14: "GTIN"}.get(len(gtin), "")


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


def _candidate(field: TemplateField, profile: TemplateProfile, product: dict[str, Any]) -> Any:
    base = field.base_name
    if base == "product_type":
        return profile.category
    if base == "item_name":
        return str(product.get("productName") or "").strip()
    if base in {"model_number", "part_number"}:
        return str(product.get("mpn") or "").strip()
    if base == "brand":
        return _brand(product)
    if base == "amzn1.volt.ca.product_id_value":
        return _valid_gtin(product.get("upc"))
    if base == "amzn1.volt.ca.product_id_type":
        return _gtin_type(_valid_gtin(product.get("upc")))
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
    if base == "country_of_origin":
        return str(product.get("placeOfOrigin") or "").strip()
    return None


def _coerce_dropdown(field: TemplateField, value: Any) -> Any:
    if value in (None, "") or not field.is_dropdown:
        return value
    if not field.allowed_values:
        return None
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
                candidate = _candidate(field, profile, product)
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
                    value = _coerce_dropdown(field, candidate)
                    if field.is_dropdown and value in (None, ""):
                        plan.issues.append(_issue(row, field, "warning", "dropdown_required", f"GIGA 候选值 {candidate!r} 不在模板允许值中"))
                    else:
                        plan.changes[(row.row, field.column)] = value
                        final_values[field.field_id] = value

            for field in profile.fields:
                if final_values.get(field.field_id) not in (None, ""):
                    continue
                if field.requirement == "required":
                    plan.issues.append(_issue(row, field, "error", "missing_required", "Amazon 必填字段无法从 GIGA 数据自动填写"))
                elif field.requirement == "conditionally_required":
                    plan.issues.append(_issue(row, field, "warning", "conditional_attention", "Amazon 条件必填字段为空，需要运营确认是否触发"))
        return plan
    finally:
        workbook.close()
