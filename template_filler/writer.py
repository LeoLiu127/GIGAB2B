from __future__ import annotations

import copy
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl.utils import get_column_letter

from .models import TemplateProfile


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


def write_filled_workbook(
    source_path: str | Path,
    output_path: str | Path,
    profile: TemplateProfile,
    changes: dict[tuple[int, int], Any],
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
