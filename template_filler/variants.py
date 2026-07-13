from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .models import SkuRow, TemplateProfile, ValidationIssue


@dataclass(frozen=True)
class ListingProducts:
    """Complete raw-product result for one GIGA listing discovery."""

    seed_sku: str
    main_sku: str
    requested_skus: tuple[str, ...]
    products: dict[str, dict[str, Any]]
    missing_skus: tuple[str, ...] = ()
    skipped_skus: tuple[str, ...] = ()
    over_limit: bool = False
    warning: str | None = None


@dataclass(frozen=True)
class VariantRow:
    source_row: int
    output_row: int
    sku: str
    role: str  # seed | parent | child | omit
    parent_sku: str = ""
    variation_theme: str = ""
    product: dict[str, Any] | None = None


@dataclass(frozen=True)
class VariantGroup:
    seed_sku: str
    parent_sku: str = ""
    child_skus: tuple[str, ...] = ()
    variation_theme: str = ""
    status: str = "expanded"
    message: str = ""
    expected_children: int | None = None
    actual_children: int | None = None
    skipped_association_skus: tuple[str, ...] = ()
    collection_status: str = ""

    def to_dict(self) -> dict[str, Any]:
        result = {
            "seed_sku": self.seed_sku,
            "parent_sku": self.parent_sku,
            "child_skus": list(self.child_skus),
            "variation_theme": self.variation_theme,
            "status": self.status,
            "message": self.message,
        }
        if self.expected_children is not None and self.actual_children is not None:
            result.update(
                {
                    "expected_children": self.expected_children,
                    "actual_children": self.actual_children,
                    "skipped_association_skus": list(self.skipped_association_skus),
                    "collection_status": self.collection_status,
                }
            )
        return result


@dataclass
class VariantExpansion:
    rows: list[VariantRow] = field(default_factory=list)
    issues: list[ValidationIssue] = field(default_factory=list)
    groups: list[VariantGroup] = field(default_factory=list)
    seed_rows_count: int = 0

    @property
    def summary(self) -> dict[str, int]:
        return {
            "seed_rows": self.seed_rows_count,
            "groups_expanded": sum(group.status == "expanded" for group in self.groups),
            "groups_blocked": sum(group.status == "blocked" for group in self.groups),
            "parents_added": sum(row.role == "parent" for row in self.rows),
            "children_added": sum(row.role == "child" for row in self.rows),
        }


_COMPONENT_ALIASES: dict[str, tuple[str, ...]] = {
    "COLOR": ("mainColor", "Main Color", "Color", "Colour"),
    "COLOUR": ("mainColor", "Main Color", "Color", "Colour"),
    "MATERIAL": ("mainMaterial", "Main Material", "Material"),
    "FABRIC_TYPE": ("fabricType", "Fabric Type", "Fabric"),
    "FRAME_MATERIAL_TYPE": ("frameMaterialType", "Frame Material Type", "Frame Material"),
    "FRAME_MATERIAL": ("frameMaterial", "Frame Material", "Frame Material Type"),
    "SEAT_MATERIAL_TYPE": ("seatMaterialType", "Seat Material Type", "Seat Material"),
    "SIZE": ("size", "Size"),
}


def _component_field_matches(field, component: str) -> bool:
    if component in {"COLOR", "COLOUR"}:
        return field.base_name == "color"
    if component == "MATERIAL":
        return field.base_name == "material"
    if component == "FABRIC_TYPE":
        return field.base_name == "fabric_type"
    if component in {"FRAME_MATERIAL", "FRAME_MATERIAL_TYPE"}:
        return field.base_name in {"frame", "frame_material", "frame_material_type"} and "material" in field.field_id
    if component == "SEAT_MATERIAL_TYPE":
        return field.base_name == "seat" and "material_type" in field.field_id
    if component == "SIZE":
        return field.base_name == "size"
    return False


def _component_can_be_written(profile: TemplateProfile, component: str, products: list[dict[str, Any]]) -> bool:
    values = [attribute_value(product, component) for product in products]
    fields = [field for field in profile.fields if _component_field_matches(field, component)]
    for field in fields:
        if not field.is_dropdown or not field.allowed_values:
            return True
        if all(any(value.casefold() == allowed.casefold() for allowed in field.allowed_values) for value in values):
            return True
    return False


def _normalized_key(value: object) -> str:
    return "".join(char for char in str(value or "").casefold() if char.isalnum())


def attribute_value(product: dict[str, Any], component: str) -> str:
    aliases = _COMPONENT_ALIASES.get(component, ())
    attributes = product.get("attributes") or {}
    normalized_attributes = {_normalized_key(key): value for key, value in attributes.items()} if isinstance(attributes, dict) else {}
    for alias in aliases:
        direct = product.get(alias)
        if direct not in (None, ""):
            return str(direct).strip()
        attribute = normalized_attributes.get(_normalized_key(alias))
        if attribute not in (None, ""):
            return str(attribute).strip()
    if component == "SIZE":
        dimensions = (
            product.get("assembledLength"),
            product.get("assembledWidth"),
            product.get("assembledHeight"),
        )
        if all(value not in (None, "") for value in dimensions):
            unit = str(
                product.get("assembledLengthUnit")
                or product.get("assembledWidthUnit")
                or product.get("assembledHeightUnit")
                or "cm"
            ).strip()
            return f"{' x '.join(str(value).strip() for value in dimensions)} {unit}".strip()
    return ""


def infer_variation_theme(profile: TemplateProfile, products: list[dict[str, Any]]) -> tuple[str, str]:
    field = next((field for field in profile.fields if field.base_name == "variation_theme"), None)
    if field is None or not field.allowed_values:
        return "", "模板没有可用的 Variation Theme 允许值"

    candidates: list[tuple[str, int]] = []
    for allowed in field.allowed_values:
        components = tuple(part.strip().upper() for part in str(allowed).split("/") if part.strip())
        if not components or any(component not in _COMPONENT_ALIASES for component in components):
            continue
        values = [set() for _ in components]
        complete = True
        for product in products:
            for index, component in enumerate(components):
                value = attribute_value(product, component)
                if not value:
                    complete = False
                    break
                values[index].add(value.casefold())
            if not complete:
                break
        if complete and all(len(value_set) > 1 for value_set in values) and all(
            _component_can_be_written(profile, component, products) for component in components
        ):
            canonical_components = {"COLOR" if component == "COLOUR" else component for component in components}
            candidates.append((str(allowed), len(canonical_components)))

    if not candidates:
        return "", "无法从 GIGA 可验证属性推断出模板允许的唯一变体主题"
    max_specificity = max(specificity for _, specificity in candidates)
    most_specific = [name for name, specificity in candidates if specificity == max_specificity]
    if len(most_specific) == 1:
        return most_specific[0], ""
    return "", f"存在多个可用变体主题: {' / '.join(most_specific)}"


def _issue(seed: SkuRow, status: str, message: str) -> ValidationIssue:
    return ValidationIssue(
        sku=seed.sku,
        row=seed.row,
        field_id="__variant_expansion__",
        label="Variant Expansion",
        severity="error",
        status=status,
        message=message,
    )


def _warning_issue(seed: SkuRow, status: str, message: str) -> ValidationIssue:
    return ValidationIssue(
        sku=seed.sku,
        row=seed.row,
        field_id="__variant_expansion__",
        label="Variant Expansion",
        severity="warning",
        status=status,
        message=message,
    )


def skipped_association_message(skipped_skus: tuple[str, ...]) -> str:
    if not skipped_skus:
        return ""
    return (
        f"GIGA 另返回 {len(skipped_skus)} 个无法查询商品详情的关联编号，"
        f"未计入有效子体：{'、'.join(skipped_skus)}。"
    )


def collection_result_message(expected: int, actual: int, skipped_skus: tuple[str, ...] = ()) -> str:
    state = "采集完整" if actual == expected else "采集不完整"
    return (
        f"{state}：预计 {expected} 个有效子体，实际生成 {actual} 个子体。"
        f"{skipped_association_message(skipped_skus)}"
    )


def _collection_group(
    seed_sku: str,
    listing: ListingProducts,
    *,
    status: str,
    message: str,
    actual_children: int = 0,
    parent_sku: str = "",
    child_skus: tuple[str, ...] = (),
    variation_theme: str = "",
) -> VariantGroup:
    expected_children = len(listing.requested_skus)
    return VariantGroup(
        seed_sku=seed_sku,
        parent_sku=parent_sku,
        child_skus=child_skus,
        variation_theme=variation_theme,
        status=status,
        message=message,
        expected_children=expected_children,
        actual_children=actual_children,
        skipped_association_skus=listing.skipped_skus,
        collection_status="complete" if actual_children == expected_children else "incomplete",
    )


def expand_variant_rows(
    profile: TemplateProfile,
    fetch_listing: Callable[[str, str], ListingProducts],
    *,
    enabled: bool = True,
    manual_themes: dict[int, str] | None = None,
) -> VariantExpansion:
    """Materialize template seed rows into safe parent/child row instructions."""
    result = VariantExpansion(seed_rows_count=len(profile.sku_rows))
    offset = 0
    seen_groups: set[frozenset[str]] = set()
    for seed in profile.sku_rows:
        output_row = seed.row + offset
        if not enabled:
            result.rows.append(VariantRow(seed.row, output_row, seed.sku, "seed"))
            continue

        listing = fetch_listing(seed.sku, profile.market)
        group_key = frozenset(listing.requested_skus or (seed.sku,))
        if group_key in seen_groups:
            result.rows.append(VariantRow(seed.row, output_row, seed.sku, "omit"))
            result.groups.append(VariantGroup(seed.sku, status="duplicate", message="该 SKU 所属 Listing 已由前一行展开"))
            offset -= 1
            continue
        seen_groups.add(group_key)

        if listing.over_limit:
            message = listing.warning or "同一 Listing 的 SKU 数量超过 200，不能安全展开"
            result.rows.append(VariantRow(seed.row, output_row, seed.sku, "seed", product=listing.products.get(seed.sku)))
            result.issues.append(_issue(seed, "variant_group_too_large", message))
            result.groups.append(_collection_group(seed.sku, listing, status="blocked", message=message))
            continue
        if listing.missing_skus or len(listing.products) != len(listing.requested_skus):
            missing = ", ".join(listing.missing_skus) or "关联 SKU"
            message = listing.warning or f"GIGA 未返回完整变体详情: {missing}"
            result.rows.append(VariantRow(seed.row, output_row, seed.sku, "seed", product=listing.products.get(seed.sku)))
            result.issues.append(_issue(seed, "variant_fetch_incomplete", message))
            result.groups.append(_collection_group(seed.sku, listing, status="blocked", message=message))
            continue
        if len(listing.requested_skus) == 1:
            result.rows.append(VariantRow(seed.row, output_row, seed.sku, "seed", product=listing.products.get(seed.sku)))
            result.groups.append(VariantGroup(seed.sku, status="no_variants", message="GIGA 未发现可展开的关联 SKU"))
            continue
        products = [listing.products[sku] for sku in listing.requested_skus if sku in listing.products]
        theme, reason = infer_variation_theme(profile, products)
        if not theme:
            result.rows.append(VariantRow(seed.row, output_row, seed.sku, "seed", product=listing.products.get(seed.sku)))
            result.issues.append(_issue(seed, "variant_theme_unresolved", reason))
            result.groups.append(_collection_group(seed.sku, listing, status="blocked", message=reason))
            continue
        manual_theme = str((manual_themes or {}).get(seed.row) or "").strip()
        if manual_theme and manual_theme.casefold() != theme.casefold():
            message = f"运营已填写主题 {manual_theme!r}，与 GIGA 推断主题 {theme!r} 不一致"
            result.rows.append(VariantRow(seed.row, output_row, seed.sku, "seed", product=listing.products.get(seed.sku)))
            result.issues.append(_issue(seed, "variant_manual_theme_conflict", message))
            result.groups.append(_collection_group(seed.sku, listing, status="blocked", message=message))
            continue

        skipped_message = skipped_association_message(listing.skipped_skus)
        if skipped_message:
            result.issues.append(_warning_issue(seed, "variant_associations_skipped", skipped_message))

        parent_sku = f"{listing.main_sku or seed.sku}-PARENT"
        result.rows.append(VariantRow(seed.row, output_row, parent_sku, "parent", variation_theme=theme, product=products[0]))
        for index, sku in enumerate(listing.requested_skus, start=1):
            result.rows.append(VariantRow(seed.row, output_row + index, sku, "child", parent_sku, theme, listing.products[sku]))
        child_count = len(listing.requested_skus)
        result.groups.append(
            _collection_group(
                seed.sku,
                listing,
                status="expanded",
                message=collection_result_message(child_count, child_count, listing.skipped_skus),
                actual_children=child_count,
                parent_sku=parent_sku,
                child_skus=listing.requested_skus,
                variation_theme=theme,
            )
        )
        offset += len(listing.requested_skus)
    return result
