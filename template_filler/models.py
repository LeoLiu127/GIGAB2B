from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class TemplateField:
    field_id: str
    base_name: str
    column: int
    column_letter: str
    label: str
    requirement: str
    is_dropdown: bool = False
    validation_formula: str | None = None
    allowed_values: tuple[str, ...] = ()


@dataclass(frozen=True)
class SkuRow:
    row: int
    sku: str
    product_type: str = ""


@dataclass(frozen=True)
class TemplateProfile:
    source_path: Path
    platform: str
    market: str
    marketplace_id: str
    language_tag: str
    category: str
    sheet_name: str
    label_row: int
    attribute_row: int
    data_row: int
    fields: tuple[TemplateField, ...]
    sku_rows: tuple[SkuRow, ...]
    has_vba: bool = False

    def field_by_base_name(self, base_name: str) -> TemplateField:
        for item in self.fields:
            if item.base_name == base_name:
                return item
        raise KeyError(base_name)

    def field_by_id(self, field_id: str) -> TemplateField:
        for item in self.fields:
            if item.field_id == field_id:
                return item
        raise KeyError(field_id)


@dataclass(frozen=True)
class ValidationIssue:
    sku: str
    row: int
    field_id: str
    label: str
    severity: str
    status: str
    message: str
    allowed_values: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "sku": self.sku,
            "row": self.row,
            "field_id": self.field_id,
            "label": self.label,
            "severity": self.severity,
            "status": self.status,
            "message": self.message,
            "allowed_values": list(self.allowed_values),
        }


@dataclass(frozen=True)
class FilledField:
    sku: str
    row: int
    field_id: str
    label: str
    value: Any
    source: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "sku": self.sku,
            "row": self.row,
            "field_id": self.field_id,
            "label": self.label,
            "value": self.value,
            "source": self.source,
        }


@dataclass
class FillPlan:
    changes: dict[tuple[int, int], Any] = field(default_factory=dict)
    issues: list[ValidationIssue] = field(default_factory=list)
    filled_fields: list[FilledField] = field(default_factory=list)
    rows_processed: int = 0

    @property
    def fields_filled(self) -> int:
        return len(self.changes)
