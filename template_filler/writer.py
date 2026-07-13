from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl.utils import get_column_letter

from .models import TemplateProfile
from .variants import VariantRow


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
XML_NS = "http://www.w3.org/XML/1998/namespace"

ET.register_namespace("", MAIN_NS)
ET.register_namespace("r", REL_NS)


def _sheet_part(archive: ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationship_targets = {
        item.attrib["Id"]: item.attrib["Target"]
        for item in relationships.findall(f"{{{PKG_REL_NS}}}Relationship")
    }
    sheets = workbook.find(f"{{{MAIN_NS}}}sheets")
    if sheets is None:
        raise ValueError("workbook.xml 缺少 sheets")
    for sheet in sheets:
        if sheet.attrib.get("name") != sheet_name:
            continue
        relationship_id = sheet.attrib[f"{{{REL_NS}}}id"]
        target = relationship_targets[relationship_id].lstrip("/")
        return target if target.startswith("xl/") else f"xl/{target}"
    raise ValueError(f"找不到工作表部件: {sheet_name}")


def _row(sheet_data, row_number: int):
    for item in sheet_data.findall(f"{{{MAIN_NS}}}row"):
        current = int(item.attrib.get("r", "0"))
        if current == row_number:
            return item
        if current > row_number:
            created = ET.Element(f"{{{MAIN_NS}}}row", {"r": str(row_number)})
            sheet_data.insert(list(sheet_data).index(item), created)
            return created
    return ET.SubElement(sheet_data, f"{{{MAIN_NS}}}row", {"r": str(row_number)})


def _cell(row_element, row_number: int, column: int):
    reference = f"{get_column_letter(column)}{row_number}"
    for item in row_element.findall(f"{{{MAIN_NS}}}c"):
        existing = item.attrib.get("r", "")
        if existing == reference:
            return item
        existing_column = ''.join(char for char in existing if char.isalpha())
        if existing_column and _column_index(existing_column) > column:
            created = ET.Element(f"{{{MAIN_NS}}}c", {"r": reference})
            row_element.insert(list(row_element).index(item), created)
            return created
    return ET.SubElement(row_element, f"{{{MAIN_NS}}}c", {"r": reference})


def _column_index(letters: str) -> int:
    value = 0
    for char in letters:
        value = value * 26 + ord(char.upper()) - ord("A") + 1
    return value


def _set_value(cell, value: Any) -> None:
    for child in list(cell):
        if child.tag in {f"{{{MAIN_NS}}}v", f"{{{MAIN_NS}}}is", f"{{{MAIN_NS}}}f"}:
            cell.remove(child)
    if isinstance(value, bool):
        cell.attrib["t"] = "b"
        ET.SubElement(cell, f"{{{MAIN_NS}}}v").text = "1" if value else "0"
    elif isinstance(value, (int, float)):
        cell.attrib.pop("t", None)
        ET.SubElement(cell, f"{{{MAIN_NS}}}v").text = str(value)
    else:
        text = str(value)
        cell.attrib["t"] = "inlineStr"
        inline = ET.SubElement(cell, f"{{{MAIN_NS}}}is")
        text_element = ET.SubElement(inline, f"{{{MAIN_NS}}}t")
        if text != text.strip():
            text_element.attrib[f"{{{XML_NS}}}space"] = "preserve"
        text_element.text = text


def _clear_value(cell) -> None:
    for child in list(cell):
        if child.tag in {f"{{{MAIN_NS}}}v", f"{{{MAIN_NS}}}is", f"{{{MAIN_NS}}}f"}:
            cell.remove(child)
    cell.attrib.pop("t", None)


def _set_row_reference(row_element, row_number: int) -> None:
    row_element.attrib["r"] = str(row_number)
    for cell in row_element.findall(f"{{{MAIN_NS}}}c"):
        reference = cell.attrib.get("r", "")
        letters = "".join(char for char in reference if char.isalpha())
        if letters:
            cell.attrib["r"] = f"{letters}{row_number}"


_RANGE_PART = re.compile(r"(\$?[A-Z]{1,3}\$?)(\d+)")
_RELATIONSHIP_BASE_NAMES = {"contribution_sku", "parentage_level", "child_parent_sku_relationship", "variation_theme"}
_MAX_EXCEL_ROW = 1_048_576


def _adjust_sqref(value: str, anchor_row: int, delta: int) -> str:
    if not value or not delta:
        return value

    def adjust_range(part: str) -> str:
        matches = list(_RANGE_PART.finditer(part))
        if not matches:
            return part
        rows = [int(match.group(2)) for match in matches]
        start, end = min(rows), max(rows)
        if end < anchor_row:
            return part
        # A full-height validation already covers every inserted child row.
        # Extending it would produce the invalid Excel row 1,048,577.
        if end == _MAX_EXCEL_ROW and start <= anchor_row <= end:
            return part
        if start > anchor_row:
            return _RANGE_PART.sub(lambda match: f"{match.group(1)}{min(int(match.group(2)) + delta, _MAX_EXCEL_ROW)}", part)
        # The template row belongs to this validation range: keep its start and extend its end.
        if len(matches) == 1 and start == end:
            match = matches[0]
            return f"{part}:{match.group(1)}{end + delta}"
        updated = []
        for index, match in enumerate(matches):
            row = int(match.group(2))
            replacement = min(row + delta, _MAX_EXCEL_ROW) if index == len(matches) - 1 and row == end else row
            updated.append((match.start(2), match.end(2), str(replacement)))
        for start_index, end_index, replacement in reversed(updated):
            part = part[:start_index] + replacement + part[end_index:]
        return part

    return " ".join(adjust_range(part) for part in value.split())


def _adjust_worksheet_ranges(root, anchor_row: int, delta: int) -> None:
    for validation in root.findall(f".//{{{MAIN_NS}}}dataValidation"):
        if validation.attrib.get("sqref"):
            validation.attrib["sqref"] = _adjust_sqref(validation.attrib["sqref"], anchor_row, delta)
    for conditional in root.findall(f".//{{{MAIN_NS}}}conditionalFormatting"):
        if conditional.attrib.get("sqref"):
            conditional.attrib["sqref"] = _adjust_sqref(conditional.attrib["sqref"], anchor_row, delta)
    for merge in root.findall(f".//{{{MAIN_NS}}}mergeCell"):
        if merge.attrib.get("ref"):
            merge.attrib["ref"] = _adjust_sqref(merge.attrib["ref"], anchor_row, delta)
    for element_name in ("autoFilter", "dimension"):
        element = root.find(f"{{{MAIN_NS}}}{element_name}")
        if element is not None and element.attrib.get("ref"):
            element.attrib["ref"] = _adjust_sqref(element.attrib["ref"], anchor_row, delta)


def _materialize_rows(sheet_data, root, profile: TemplateProfile, rows: list[VariantRow]) -> None:
    by_source: dict[int, list[VariantRow]] = {}
    for row in rows:
        by_source.setdefault(row.source_row, []).append(row)
    if not by_source:
        return

    offset = 0
    output_rows = []
    for source_row in list(sheet_data.findall(f"{{{MAIN_NS}}}row")):
        original_number = int(source_row.attrib.get("r", "0"))
        materializations = by_source.get(original_number)
        if materializations is None:
            clone = copy.deepcopy(source_row)
            _set_row_reference(clone, original_number + offset)
            output_rows.append(clone)
            continue

        visible_rows = [row for row in materializations if row.role != "omit"]
        anchor_row = original_number + offset
        for materialization in sorted(visible_rows, key=lambda row: row.output_row):
            clone = copy.deepcopy(source_row)
            _set_row_reference(clone, materialization.output_row)
            if materialization.role == "child":
                for field in profile.fields:
                    cell = _cell(clone, materialization.output_row, field.column)
                    _clear_value(cell)
            elif materialization.role == "parent":
                for field in profile.fields:
                    if field.base_name in _RELATIONSHIP_BASE_NAMES:
                        cell = _cell(clone, materialization.output_row, field.column)
                        _clear_value(cell)
            output_rows.append(clone)

        delta = len(visible_rows) - 1
        _adjust_worksheet_ranges(root, anchor_row, delta)
        offset += delta

    for item in list(sheet_data):
        sheet_data.remove(item)
    for item in output_rows:
        sheet_data.append(item)


def write_filled_workbook(
    source_path: str | Path,
    output_path: str | Path,
    profile: TemplateProfile,
    changes: dict[tuple[int, int], Any],
    *,
    row_materializations: list[VariantRow] | None = None,
) -> Path:
    source = Path(source_path).resolve()
    output = Path(output_path).resolve()
    if source == output:
        raise ValueError("输出文件不能覆盖原始模板")
    output.parent.mkdir(parents=True, exist_ok=True)

    with ZipFile(source, "r") as original:
        target_part = _sheet_part(original, profile.sheet_name)
        root = ET.fromstring(original.read(target_part))
        sheet_data = root.find(f"{{{MAIN_NS}}}sheetData")
        if sheet_data is None:
            raise ValueError(f"{profile.sheet_name} 缺少 sheetData")
        _materialize_rows(sheet_data, root, profile, row_materializations or [])
        for (row_number, column), value in sorted(changes.items()):
            row_element = _row(sheet_data, row_number)
            cell = _cell(row_element, row_number, column)
            _set_value(cell, value)
        modified_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)

        with ZipFile(output, "w", compression=ZIP_DEFLATED) as generated:
            for item in original.infolist():
                data = modified_xml if item.filename == target_part else original.read(item.filename)
                generated.writestr(copy.copy(item), data)
    return output
