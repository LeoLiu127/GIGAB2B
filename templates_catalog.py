"""模板注册表（多平台 + 多品类）的单一事实来源。

本模块把"模板文件 + 列映射 + 固定值 + 包材算法 + 文案 fallback"打包为
[f.TemplateDescriptor]，运行时按 (platform, category, market) 查表调用。

设计要点
--------
- 只描述"模板怎么填"，不负责打开 / 写入 / 保存 .xlsm（这部分在 app.py 里的 _write_row）
- 单平台多市场可以共用同一份 descriptor（如 Amazon PLANTER 5 个市场的列结构一致），
  市场到模板文件的映射由 [f.MARKET_TEMPLATES] 单独维护
- 平台状态机：[f.PLATFORM_STATUS]
    - "implemented": fill 已实现
    - "stub": 仅占位，fill 时走 template_skipped 兜底
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


# ─────────────────────────────────────────────────────────────────
# 平台状态机（Walmart / Wayfair 留作扩展位）
# ─────────────────────────────────────────────────────────────────
PLATFORM_STATUS: dict[str, str] = {
    "amazon":  "implemented",
    "walmart": "stub",
    "wayfair": "stub",
}


def is_platform_supported(platform: str) -> bool:
    """某个平台是否已经实际实现 fill。False 时前端应走 template_skipped 提示。"""
    return PLATFORM_STATUS.get(platform) == "implemented"


# ─────────────────────────────────────────────────────────────────
# 市场 → 关键词列表（按顺序命中首个；保留与历史 app.py 同样的 DE→FR→US→UK 顺序）
# ─────────────────────────────────────────────────────────────────
MARKET_KEYWORDS: list[tuple[str, list[str]]] = [
    ("DE_TAX",     ["de", "german", "deutsch"]),
    ("DE_TAXFREE", ["de-taxfree", "taxfree"]),
    ("FR",         ["fr", "french", "franc"]),
    ("US",         ["us", "america", "usa"]),
    ("UK",         ["uk", "british", "england"]),
]


# ─────────────────────────────────────────────────────────────────
# 市场 → 模板文件（Amazon PLANTER 用；DE_TAX / DE_TAXFREE 共享同一份）
# ─────────────────────────────────────────────────────────────────
MARKET_TEMPLATES: dict[str, str] = {
    "DE_TAX":     "PLANTER-de.xlsm",
    "DE_TAXFREE": "PLANTER-de.xlsm",
    "UK":         "PLANTER-uk.xlsm",
    "US":         "PLANTER-us.xlsm",
    "FR":         "PLANTER-fr.xlsm",
}


# ─────────────────────────────────────────────────────────────────
# 包材算法（PLANTER 类的硬编码参数；后续 CHAIR 等品类可在此处分支）
# ─────────────────────────────────────────────────────────────────
def planter_packaging(weight_kg: float) -> tuple[float, float, float, float]:
    """PLANTER 品类包材算法：长 116/2, 宽 30/2, 高 5.5×4, 重量 = weight/2。"""
    pkg_l = round(116 / 2, 1)
    pkg_w = round(30 / 2, 1)
    pkg_h = round(5.5 * 4, 1)
    pkg_wt = round(weight_kg / 2, 1)
    return pkg_l, pkg_w, pkg_h, pkg_wt


# ─────────────────────────────────────────────────────────────────
# 品类 dispatcher（本期只注册 PLANTER，其他回退到 PLANTER 行为）
# ─────────────────────────────────────────────────────────────────
def packaging_for(category: str, weight_kg: float) -> tuple[float, float, float, float]:
    if category == "PLANTER":
        return planter_packaging(weight_kg)
    # 兜底：保持与历史 PLANTER 行为完全一致，避免任何回归
    return planter_packaging(weight_kg)


def product_type_for(category: str) -> str:
    if category == "PLANTER":
        return "PLANTER"
    # 历史行为：硬编码 "PLANTER"。其他品类保持旧行为，不在本期重构。
    return "PLANTER"


# ─────────────────────────────────────────────────────────────────
# 模板描述符
# ─────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class TemplateDescriptor:
    """一份 Excel 模板的填表规则。

    字段
    ----
    platform:        "amazon" / "walmart" / "wayfair"
    category:        "PLANTER" / "CHAIR" / ...
    sheet_name:      .xlsm 中的工作表名（Amazon 用 "Vorlage"）
    data_row:        数据写入的起始行（1-based；Amazon PLANTER 用第 7 行）
    col_map:         逻辑字段名 → Excel 列号（1-based）
    fixed_values:    硬编码字段（product_type / manufacturer / sku2 等）
    image_slot_start:
                     main 图所在的列号；pt1..ptN 顺延（Amazon = 列 24 + 列 25..32）
    image_slot_count: 共多少图槽（Amazon = 9）
    description_col: description 字段所在列（部分模板与 bullets 同行/分列）
    bullet_cols:     5 个 bullet 各自的列号 tuple
    special_attr_cols:
                     5 条关键卖点的列号 tuple（Amazon = 47..51）
    search_terms_fallback_by_lang:
                     DE / EN / FR 三语种 fallback 关键词
    special_attrs_by_market:
                     DE_TAX/DE_TAXFREE/UK/US/FR → 5 条关键卖点文案
    packaging:       (weight_kg) -> (pkg_l, pkg_w, pkg_h, pkg_wt)
    """

    platform: str
    category: str
    sheet_name: str
    data_row: int
    col_map: dict
    fixed_values: dict
    image_slot_start: int          # main_image column
    image_slot_count: int
    description_col: int
    bullet_cols: tuple
    special_attr_cols: tuple
    search_terms_fallback_by_lang: dict
    special_attrs_by_market: dict
    packaging: Callable[[float], tuple]


# ─────────────────────────────────────────────────────────────────
# Amazon × PLANTER 描述符（5 个市场共用同一份列结构）
# ─────────────────────────────────────────────────────────────────
def _amazon_planter_descriptor() -> TemplateDescriptor:
    """Amazon Bulk Upload 标准列结构。5 个市场共用同一份 descriptor。

    具体列号来自历史 app.py:1327-1343 COL_MAP + 1465-1471 special_attr 列 47..51。
    """
    col_map = {
        "sku": 1, "product_type": 2, "sku2": 3, "product_name": 7,
        "mpn": 20, "manufacturer": 21, "main_image": 24,
        "bullet1": 41, "bullet2": 42, "bullet3": 43, "bullet4": 44, "bullet5": 45,
        "search_terms": 46,
        "style": 52, "material": 53, "item_count": 58, "color": 60,
        "length": 104, "length_unit": 105, "height": 106, "height_unit": 107,
        "width": 108, "width_unit": 109,
        "weight": 115, "weight_unit": 116,
        "country": 219,
        "pkg_length": 175, "pkg_length_unit": 176,
        "pkg_width": 177, "pkg_width_unit": 178,
        "pkg_height": 179, "pkg_height_unit": 180,
        "pkg_weight": 181, "pkg_weight_unit": 182,
        "pdf": 271,
        "description": 40,
    }
    return TemplateDescriptor(
        platform="amazon",
        category="PLANTER",
        sheet_name="Vorlage",
        data_row=7,
        col_map=col_map,
        fixed_values={
            "product_type":  "PLANTER",
            "sku2":          "full_update",
            "manufacturer":  "YUDA HOME FURNITURE",
            "country":       "China",
        },
        image_slot_start=24,  # main_image 在列 24；pt1..pt8 在列 25..32
        image_slot_count=9,
        description_col=40,
        bullet_cols=(41, 42, 43, 44, 45),
        special_attr_cols=(47, 48, 49, 50, 51),
        search_terms_fallback_by_lang={
            "DE": [
                "Hochbeet Metall", "Pflanzenbeet", "Gartenbeet", "Gemüsebeet",
                "Kräuterbeet", "Rostfrei", "Blumenbeet",
            ],
            "EN": [
                "raised garden bed", "metal planter", "garden bed", "flower pot",
                "galvanized steel", "outdoor planter",
            ],
            "FR": [
                "jardiiniere metal", "bac a fleurs", "lit surleve", "potager",
                "acier galvanise", "jardin",
            ],
        },
        special_attrs_by_market={
            "DE_TAX": [
                "Robustes Stahlblech mit Zink-Aluminium Beschichtung",
                "Wetterfest und Rostschutz",
                "Einfache Montage, Bausatz ohne Boden",
                "Offenes Design für freies Wurzelwachstum",
                "Ideal für Gemüse, Kräuter und Blumen",
            ],
            "DE_TAXFREE": [
                # 与 DE_TAX 共享同一份条目，fallback 由调用方决定
                "Robustes Stahlblech mit Zink-Aluminium Beschichtung",
                "Wetterfest und Rostschutz",
                "Einfache Montage, Bausatz ohne Boden",
                "Offenes Design für freies Wurzelwachstum",
                "Ideal für Gemüse, Kräuter und Blumen",
            ],
            "UK": [
                "Robust galvanized steel with zinc-aluminium coating",
                "Weatherproof and rust-resistant",
                "Easy assembly, base-less kit",
                "Open base design for free root growth",
                "Ideal for vegetables, herbs, and flowers",
            ],
            "US": [
                "Heavy-duty galvanized steel with zinc-aluminium coating",
                "Weatherproof and rust-resistant",
                "Easy assembly, base-less kit",
                "Open base design for free root growth",
                "Ideal for vegetables, herbs, and flowers",
            ],
            "FR": [
                "Acier galvanise robuste avec revetement zinc-aluminium",
                "Resistant aux intemperies et a la rouille",
                "Montage facile, kit sans fond",
                "Conception a fond ouvert pour une croissance libre des racines",
                "Ideal pour legumes, herbes et fleurs",
            ],
        },
        packaging=planter_packaging,
    )


# 单一实例：Amazon × PLANTER
AMAZON_PLANTER = _amazon_planter_descriptor()


# ─────────────────────────────────────────────────────────────────
# 检索 API
# ─────────────────────────────────────────────────────────────────
def get_descriptor(platform: str = "amazon", category: str = "PLANTER", market: str | None = None) -> TemplateDescriptor | None:
    """查表返回平台+品类对应的模板描述符。

    参数
    ----
    platform:  "amazon" / "walmart" / "wayfair"
    category:  "PLANTER" / "CHAIR" / ...
    market:    当前为兼容接口保留（暂未按市场分支）

    返回
    ----
    TemplateDescriptor | None —— 当平台未实现或 (platform, category) 未注册时返回 None。
    """
    if not is_platform_supported(platform):
        return None
    if platform == "amazon" and category == "PLANTER":
        return AMAZON_PLANTER
    # 未来：在 elif 处接 CHAIR 等品类 / Walmart / Wayfair
    return None


def template_file_for_market(market: str) -> str | None:
    """返回当前市场默认的模板文件名（如 "PLANTER-us.xlsm"）；不存在则返回 None。"""
    return MARKET_TEMPLATES.get(market)
