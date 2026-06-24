"""
GIGAB2B Web 应用后端
Flask + Python，GIGA 取数 → AI 优化 → Excel 填入

启动方式：
  python app.py
  Flask 运行在 http://localhost:5182
"""

import os
import sys
import re
import time
import base64
import hmac
import hashlib
import random
import string
import requests

# 加载 .env（giga_config 会加载，这里提前加载确保 keys 可用）
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(_env_path, override=False)
except ImportError:
    pass

from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
import openpyxl

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
CORS(app, resources={r"/api/*": {"origins": "*"}})

IMAGE_STUDIO_BASE = "http://localhost:5181"
PORT = 5182

# ─────────────────────────────────────────────────────────────────
# GIGA API
# ─────────────────────────────────────────────────────────────────

GIGA_BASE_URL = "https://openapi.gigab2b.com"
ENV_FILE = os.path.join(os.path.dirname(__file__), ".env")


def _load_env():
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
    if key and val and key not in os.environ:
            os.environ[key] = val


_load_env()

GIGA_ENV = os.getenv("GIGA_ENV", "production").lower()
GIGA_BASE_URL = "https://openapi-sandbox.gigab2b.com" if GIGA_ENV == "sandbox" else "https://openapi.gigab2b.com"

MARKET_KEYS = {
    "DE_TAX":     ("GIGA_DE_TAX_CLIENT_ID",     "GIGA_DE_TAX_CLIENT_SECRET"),
    "DE_TAXFREE": ("GIGA_DE_TAXFREE_CLIENT_ID", "GIGA_DE_TAXFREE_CLIENT_SECRET"),
    "UK":         ("GIGA_UK_CLIENT_ID",         "GIGA_UK_CLIENT_SECRET"),
    "US":         ("GIGA_US_CLIENT_ID",          "GIGA_US_CLIENT_SECRET"),
    "FR":         ("GIGA_FR_CLIENT_ID",          "GIGA_FR_CLIENT_SECRET"),
}

MARKET_NAMES = {
    "DE_TAX":     ("Amazon.de (德国·含税)",  "DE"),
    "DE_TAXFREE": ("Amazon.de (德国·免税)", "DE"),
    "UK":         ("Amazon.co.uk (英国)",   "EN"),
    "US":         ("Amazon.com (美国)",     "EN"),
    "FR":         ("Amazon.fr (法国)",      "FR"),
}


def _get_giga_creds(market: str):
    keys = MARKET_KEYS.get(market)
    if not keys:
        raise ValueError(f"未知市场: {market}")
    cid = os.environ.get(keys[0], "").strip()
    sec = os.environ.get(keys[1], "").strip()
    if not cid or not sec:
        raise RuntimeError(f"[{market}] GIGA 凭证未配置，请检查 .env")
    return cid, sec


def _nonce(l=10):
    return "".join(random.choices(string.ascii_letters + string.digits, k=l))


def _sign(client_id, client_secret, timestamp_ms, nonce, uri):
    msg = f"{client_id}&{uri}&{timestamp_ms}&{nonce}"
    key = f"{client_id}&{client_secret}&{nonce}"
    hex_digest = hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return base64.b64encode(hex_digest.encode()).decode()


def giga_fetch_product(sku: str, market: str) -> dict:
    cid, sec = _get_giga_creds(market)
    ts = int(time.time() * 1000)
    nonce_val = _nonce()
    uri = "/b2b-overseas-api/v1/buyer/product/detailInfo/v1"
    sign = _sign(cid, sec, ts, nonce_val, uri)
    try:
        resp = requests.post(
            f"{GIGA_BASE_URL}{uri}",
            json={"skus": [sku]},
            headers={
                "Content-Type": "application/json",
                "client-id": cid,
                "timestamp": str(ts),
                "nonce": nonce_val,
                "sign": sign,
            },
            timeout=30,
        )
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"GIGA API 请求失败: {e}")

    if resp.status_code != 200:
        raise RuntimeError(f"GIGA API 返回错误状态码 {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
    except ValueError:
        raise RuntimeError(f"GIGA API 返回非 JSON: HTTP {resp.status_code} {resp.text[:200]}")

    items = data.get("data") or []
    if not items:
        raise RuntimeError(f"GIGA API 返回空数据。HTTP={resp.status_code}, body={str(data)[:200]}")
    return items[0]


# ─────────────────────────────────────────────────────────────────
# AI 文案生成（通过 image-studio server）
# ─────────────────────────────────────────────────────────────────

def _check_image_studio_server() -> dict:
    """返回 server 状态和 providers。"""
    try:
        r = requests.get(f"{IMAGE_STUDIO_BASE}/api/health", timeout=5)
        if r.status_code == 200:
            return {"ok": True, "providers": r.json().get("aiProviders", {})}
    except Exception:
        pass
    return {"ok": False, "providers": {}}


def _proxy_image(url: str) -> str | None:
    try:
        r = requests.get(f"{IMAGE_STUDIO_BASE}/api/proxy-image", params={"url": url}, timeout=30)
        if r.status_code == 200:
            d = r.json()
            if d.get("ok"):
                return d.get("dataUrl")
    except Exception:
        pass
    return None


def _build_copy_prompt(product: dict, market: str) -> str:
    cfg = MARKET_NAMES.get(market, ("Amazon", "EN"))
    market_name, lang = cfg[0], cfg[1]

    MARKET_LANG = {"DE": "德语", "EN": "英语", "FR": "法语"}
    MARKET_CODE = {"DE": "DE", "EN": "EN", "FR": "FR"}
    lang_name = MARKET_LANG.get(lang, "英语")
    lang_code = MARKET_CODE.get(lang, "EN")

    sku       = product.get("sku", "")
    title_raw = product.get("productName", "")
    chars     = product.get("characteristics", [])
    attrs     = product.get("attributes", {})
    material  = product.get("mainMaterial", "")
    color     = attrs.get("Main Color") or product.get("mainColor") or ""
    style     = attrs.get("Product Style", "")
    length    = product.get("assembledLength", "")
    width     = product.get("assembledWidth", "")
    height    = product.get("assembledHeight", "")
    mpn       = product.get("mpn", "")
    manufacturer = product.get("manufacturer", "") or "YUDA HOME FURNITURE"
    category  = product.get("category", "")

    chars_lines = "\n".join(f"{i+1}. {c}" for i, c in enumerate(chars[:6]))

    use_case = attrs.get("Use Case", "")
    scenarios = []
    combined = (use_case + " " + category).lower()
    if any(w in combined for w in ["garden", "plant", "flower", "vegetable", "herb"]):
        scenarios = ["garden", "backyard", "terrace", "patio", "balcony", "outdoor", "yard", "flower", "vegetable", "herb"]
    elif any(w in combined for w in ["kitchen"]):
        scenarios = ["kitchen", "cooking", "indoor", "home"]
    elif any(w in combined for w in ["office", "desk"]):
        scenarios = ["office", "workspace", "desk", "professional"]
    else:
        scenarios = ["home", "indoor", "outdoor"]

    seo_kw = {
        "DE": {"cat": "Pflanzenbeet, Hochbeet, Gartenbeet, Gemüsebeet", "mat": "Metall, Stahlblech, verzinkt, rostfrei", "sc": "Garten, Terrasse, Balkon, Outdoor, Beet"},
        "EN": {"cat": "planter, raised bed, garden bed, plant container, flower pot", "mat": "metal, steel, galvanized, rust-proof", "sc": "garden, backyard, patio, balcony, outdoor, vegetable growing"},
        "FR": {"cat": "jardiiniere, bac a fleurs, lit surleve, potager", "mat": "acier galvanise, metal, resistant", "sc": "jardin, terrasse, balcon, exterieur, culture legume"},
    }
    kw = seo_kw.get(lang_code)
    if kw is None:
        kw = {"cat": "planter", "mat": "metal", "sc": "garden"}

    roles = {"DE": "Amazon.de (德国站) Listing 优化专家", "EN": "Amazon senior Listing optimization expert", "FR": "Expert en optimisation de Listing Amazon"}
    role = roles.get(lang_code, roles["EN"])

    title_rules = {
        "DE": "- 包含核心关键词（Hochbeet / Pflanzenbeet / Gemüsebeet）\n- 包含材质关键词（Metall / Stahlblech / verzinkt）\n- 包含主要尺寸（长×宽×高 cm）\n- 包含颜色\n- 包含品牌或制造商\n- 禁止堆砌关键词，禁止促销语（SALE / FREE / NEW）\n- 首字母大写为标准 Amazon.de 格式",
        "EN": "- Include core keywords (raised bed / planter / garden bed)\n- Include material keywords (galvanized steel / metal)\n- Include main dimensions (L×W×H cm)\n- Include color\n- Include brand or manufacturer\n- No keyword stuffing; no promotional words (SALE / FREE / NEW)\n- Standard title case",
        "FR": "- Inclure les mots-cles principaux (jardiiniere / lit surleve / bac a fleurs)\n- Inclure les mots-cles materiau (acier galvanise / metal)\n- Inclure les dimensions principales (L×l×H cm)\n- Inclure la couleur\n- Inclure la marque\n- Pas de surcharger de mots-cles, pas de mots promotionnels\n- Majuscule au debut de chaque mot",
    }.get(lang_code, "")

    st_rules = {
        "DE": "- 生成逗号分隔的德语搜索关键词（不超过250字节）\n- 包含核心词、同义词、长尾词\n- 包含当地消费者习惯词（Hochbeet / Pflanzkasten 等）\n- 包含适用场景词（Garten / Terrasse / Balkon）\n- 不要重复标题中的词\n- 禁止促销词",
        "EN": "- Generate a comma-separated list of English search keywords (max 250 bytes)\n- Include core terms, synonyms, long-tail keywords\n- Include local consumer search habits (raised garden bed vs planter box)\n- Include use-case terms (garden / patio / balcony / outdoor)\n- Do NOT repeat words already in the title\n- Forbidden: promotional words",
        "FR": "- Generer une liste de mots-cles de recherche separes par virgules (max 250 octets)\n- Inclure termes principaux, synonymes, mots-cles longue traine\n- Inclure les habitudes de recherche locales\n- Inclure les termes de scene d'utilisation\n- Ne pas repeter les mots du titre\n- Interdits: mots promotionnels",
    }.get(lang_code, "")

    prompt = f"""You are a {role}.
Generate a high-conversion Amazon {market_name} Listing in {lang_name} for the following product.

## Product Raw Data
- SKU: {sku}
- Original Title: {title_raw}
- Material: {material}
- Color: {color}
- Style: {style}
- Dimensions: {length} x {width} x {height} cm
- Model: {mpn}
- Manufacturer: {manufacturer}
- Category: {category}

## Product Characteristics
{chars_lines}

## SEO Keyword Reference
Category: {kw["cat"]}
Material: {kw["mat"]}
Use-case: {kw["sc"]}
Local search terms: {", ".join(scenarios[:6])}

## Output Requirements（STRICT format, no extra explanation）

### Product Title（max 200 characters, {lang_name}）
{title_rules}

### Five Bullet Points（5 items, each max 200 characters, {lang_name}）
1. Each bullet starts with uppercase letter
2. Include dimension/spec data where relevant
3. Highlight buyer value points (durability, ease of assembly, versatility)
4. No keyword stuffing — focus on clear customer benefit
5. Separate bullets with blank lines

### Product Description（max 4000 characters, {lang_name}）
Include: product overview, main features & advantages, use cases ({kw["sc"]}), usage instructions, brand info.
Use HTML tags（<b>, <li>, <br>）for formatting. No keyword stuffing.

### Search Terms（max 250 bytes, {lang_name}）
{st_rules}
Format: word1, word2, word3 ..."""

    return prompt


def _parse_copy_response(raw: dict) -> dict:
    result = {"title": "", "bullets": [], "description": "", "search_terms": ""}
    try:
        content = raw.get("data", {}).get("choices", [{}])[0].get("message", {}).get("content", "")
    except (KeyError, IndexError, TypeError):
        return result
    if not content:
        return result

    def section_after(text, *patterns):
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if not m:
                continue
            start = m.end()
            rest = text[start:]
            stop = re.search(r"\n(?=#{1,3}\s|\n---)", rest)
            return rest[:stop.start()] if stop else rest
        return ""

    # Title
    ts = (section_after(content, r"###\s*Product\s*Title[^\n]*\n+", r"###\s*产品标题[^\n]*\n+", r"###\s*Titre[^\n]*\n+")
          or section_after(content, r"##\s*Product\s*Title[^\n]*\n+", r"##\s*产品标题[^\n]*\n+"))
    if ts:
        for line in ts.strip().splitlines():
            line = line.strip()
            if line and len(line) > 5 and not re.match(r"^[\[\]（）()\s]+$", line):
                result["title"] = line
                break
    if not result["title"]:
        m = re.search(r"(?:^|\n)(?:Title|Titre)[：:]\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
        if m:
            result["title"] = m.group(1).strip()

    # Bullets
    bs = (section_after(content, r"###\s*Five\s*Bullet[^\n]*\n+", r"###\s*Bullets?[^\n]*\n+", r"###\s*Points[^\n]*\n+")
          or section_after(content, r"##\s*Five\s*Bullet[^\n]*\n+"))
    if bs:
        parts = re.split(r"\n\s*\n", bs)
        bullets = []
        for p in parts:
            cleaned = re.sub(r"^[\s\d.．)）\-\–•]+", "", p.strip()).strip()
            if cleaned and len(cleaned) > 10:
                bullets.append(cleaned)
            if len(bullets) >= 5:
                break
        if bullets:
            result["bullets"] = bullets
    if not result["bullets"]:
        matches = re.findall(r"(?:^|\n)(?:\d+[.．)]\s*|[-•–]\s*)([^\n]{20,300})", content, re.MULTILINE)
        if matches:
            result["bullets"] = [m.strip() for m in matches[:5] if len(m.strip()) > 10]

    # Description
    ds = (section_after(content, r"###\s*Product\s*Description[^\n]*\n+", r"###\s*产品描述[^\n]*\n+", r"###\s*Description[^\n]*\n+")
          or section_after(content, r"##\s*Product\s*Description[^\n]*\n+"))
    if ds:
        lines = [l.strip() for l in ds.splitlines() if l.strip() and not re.match(r"^[\[\]（）()\s]+$", l.strip())]
        result["description"] = "\n".join(lines).strip()

    # Search Terms
    ss = (section_after(content, r"###\s*Search\s*Terms?[^\n]*\n+", r"###\s*Suchbegriffe[^\n]*\n+", r"###\s*Mots[^\n]*\n+")
          or section_after(content, r"##\s*Search\s*Terms?[^\n]*\n+", r"##\s*Suchbegriffe[^\n]*\n+"))
    if ss:
        for line in ss.splitlines():
            line = line.strip()
            if line and not re.match(r"^[\[\]（）()\s]+$", line):
                result["search_terms"] = line
                break
    if not result["search_terms"]:
        m = re.search(r"(?:Search\s*Terms|Suchbegriffe)[：:]\s*(.+?)(?:\n|$)", content, re.IGNORECASE | re.DOTALL)
        if m:
            result["search_terms"] = m.group(1).strip()[:250]

    return result


def ai_generate_copy(product: dict, market: str) -> dict:
    """通过 image-studio server 调用 MiniMax M3 生成文案。"""
    status = _check_image_studio_server()
    if not status["ok"]:
        raise RuntimeError("image-studio server 未运行，请先启动 server（start_studio.bat）")
    if status["providers"].get("minimax") != "configured":
        raise RuntimeError(f"MiniMax API Key 未配置。image-studio server 状态: {status['providers']}")

    prompt = _build_copy_prompt(product, market)
    resp = requests.post(
        f"{IMAGE_STUDIO_BASE}/api/generate-text",
        json={"model": "minimax", "messages": [{"role": "user", "content": prompt}]},
        timeout=120,
    )
    resp.raise_for_status()
    return _parse_copy_response(resp.json())


# ─────────────────────────────────────────────────────────────────
# Excel 填入
# ─────────────────────────────────────────────────────────────────

TEMPLATE_DIR = os.path.dirname(__file__)

MARKET_KEYWORDS = [
    ("DE_TAX",     ["de", "german", "deutsch"]),
    ("DE_TAXFREE", ["de-taxfree", "taxfree"]),
    ("FR",         ["fr", "french", "franc"]),
    ("US",         ["us", "america", "usa"]),
    ("UK",         ["uk", "british", "england"]),
]

MARKET_TEMPLATES = {
    "DE_TAX":     "PLANTER-de.xlsm",
    "DE_TAXFREE": "PLANTER-de.xlsm",
    "UK":         "PLANTER-uk.xlsm",
    "US":         "PLANTER-us.xlsm",
    "FR":         "PLANTER-fr.xlsm",
}


COL_MAP = {
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


def _safe_float(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _detect_market_from_template(filepath: str) -> str | None:
    """根据上传模板文件名推断市场。"""
    name = os.path.basename(filepath).lower()
    bare = name.replace(".xlsm", "")

    # 1. 精确模板名匹配（最高优先级）
    for market, fname in MARKET_TEMPLATES.items():
        if fname.lower().replace(".xlsm", "") in bare:
            return market

    # 2. 关键词匹配（按 MARKET_KEYWORDS 顺序命中首个）
    for market, keywords in MARKET_KEYWORDS:
        if any(kw in name for kw in keywords):
            return market

    return None


def fill_excel(product: dict, ai_result: dict, market: str, template_name: str, row: int = 7, image_strategy: str = "use_giga") -> str:
    """将产品数据 + AI 优化写入 Excel，返回输出文件路径。"""
    template_path = os.path.join(TEMPLATE_DIR, template_name)
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"模板文件不存在: {template_path}")

    wb = openpyxl.load_workbook(template_path, keep_vba=True)
    ws = wb["Vorlage"]

    def w(col: int, val):
        ws.cell(row=row, column=col, value=val)

    attrs = product.get("attributes", {})
    color = attrs.get("Main Color") or product.get("mainColor") or product.get("colorMap") or ""
    imgs  = product.get("imageUrls") or []

    w(COL_MAP["sku"],             product.get("sku", ""))
    w(COL_MAP["product_type"],   "PLANTER")
    w(COL_MAP["sku2"],           "full_update")
    w(COL_MAP["product_name"],   ai_result.get("title") or product.get("productName", ""))
    w(COL_MAP["mpn"],            product.get("mpn", ""))
    w(COL_MAP["manufacturer"],   "YUDA HOME FURNITURE")

    if imgs:
        w(COL_MAP["main_image"], imgs[0])
    for i, url in enumerate(imgs[1:9], start=25):
        w(i, url)

    bullets = ai_result.get("bullets") or product.get("characteristics", [])[:5]
    w(COL_MAP["bullet1"], bullets[0] if len(bullets) > 0 else "")
    w(COL_MAP["bullet2"], bullets[1] if len(bullets) > 1 else "")
    w(COL_MAP["bullet3"], bullets[2] if len(bullets) > 2 else "")
    w(COL_MAP["bullet4"], bullets[3] if len(bullets) > 3 else "")
    w(COL_MAP["bullet5"], bullets[4] if len(bullets) > 4 else "")

    st = (ai_result.get("search_terms") or "").strip()
    if not st:
        mat = product.get("mainMaterial", "")
        kw_map = {
            "DE": ["Hochbeet Metall", "Pflanzenbeet", "Gartenbeet", "Gemüsebeet", "Kräuterbeet", "Rostfrei", "Blumenbeet", mat, color],
            "EN": ["raised garden bed", "metal planter", "garden bed", "flower pot", "galvanized steel", "outdoor planter", mat, color],
            "FR": ["jardiiniere metal", "bac a fleurs", "lit surleve", "potager", "acier galvanise", "jardin", mat, color],
        }
        market_lang = MARKET_NAMES.get(market, ("Amazon", "EN"))[1]
        fallback = " ".join([k for k in kw_map.get(market_lang, kw_map["EN"]) if k])
        st = fallback
    w(COL_MAP["search_terms"], st)

    w(COL_MAP["description"], ai_result.get("description") or "")

    _special_attrs_de = [
        "Robustes Stahlblech mit Zink-Aluminium Beschichtung",
        "Wetterfest und Rostschutz",
        "Einfache Montage, Bausatz ohne Boden",
        "Offenes Design für freies Wurzelwachstum",
        "Ideal für Gemüse, Kräuter und Blumen",
    ]
    special_attrs = {
        "DE_TAX": _special_attrs_de,
        "DE_TAXFREE": _special_attrs_de,
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
    }.get(market, _special_attrs_de)
    for i, attr in enumerate(special_attrs, start=47):
        w(i, attr)

    w(COL_MAP["style"],    attrs.get("Product Style", "Casual,Classic,Farmhouse"))
    w(COL_MAP["material"], product.get("mainMaterial", "Metal"))
    w(COL_MAP["color"],    color)
    w(COL_MAP["item_count"], 1)

    length = _safe_float(product.get("assembledLength"))
    width  = _safe_float(product.get("assembledWidth"))
    height = _safe_float(product.get("assembledHeight"))
    w(COL_MAP["length"],  length);  w(COL_MAP["length_unit"],  "cm")
    w(COL_MAP["height"], height);  w(COL_MAP["height_unit"],  "cm")
    w(COL_MAP["width"],   width);  w(COL_MAP["width_unit"],   "cm")

    weight = _safe_float(product.get("weightKg"))
    w(COL_MAP["weight"], weight); w(COL_MAP["weight_unit"], "kg")

    w(COL_MAP["country"], product.get("placeOfOrigin", "China"))

    pkg_l = round(116 / 2, 1)
    pkg_w = round(30  / 2, 1)
    pkg_h = round(5.5 * 4, 1)
    pkg_wt = round(weight / 2, 1)
    w(COL_MAP["pkg_length"],  pkg_l); w(COL_MAP["pkg_length_unit"],  "cm")
    w(COL_MAP["pkg_width"],   pkg_w); w(COL_MAP["pkg_width_unit"],   "cm")
    w(COL_MAP["pkg_height"],  pkg_h); w(COL_MAP["pkg_height_unit"],  "cm")
    w(COL_MAP["pkg_weight"], pkg_wt); w(COL_MAP["pkg_weight_unit"], "kg")

    file_urls = product.get("fileUrls") or []
    if file_urls:
        w(COL_MAP["pdf"], file_urls[0])

    if image_strategy != "use_giga":
        ws.cell(row=row, column=24).comment = openpyxl.comments.Comment(
            f"图片策略: {image_strategy} | AI 生成图片请在 image-studio 中下载后上传到 Seller Central",
            "GIGAB2B",
        )

    out_name = f"{product.get('sku','output')}-{market}.xlsm"
    out_path = os.path.join(TEMPLATE_DIR, out_name)
    wb.save(out_path)
    return out_path


# ─────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    studio = _check_image_studio_server()
    has_giga = bool(os.environ.get("GIGA_DE_TAX_CLIENT_ID"))
    return jsonify({
        "status": "ok",
        "studio": studio,
        "has_giga_creds": has_giga,
        "port": PORT,
    })


@app.route("/api/server-status", methods=["GET"])
def server_status():
    """检查 image-studio server 和 GIGA 凭证状态。"""
    studio = _check_image_studio_server()
    giga_status = {}
    for market, keys in MARKET_KEYS.items():
        cid = os.environ.get(keys[0], "").strip()
        giga_status[market] = bool(cid)
    return jsonify({
        "image_studio": studio,
        "giga_markets": giga_status,
        "detected_market": None,
    })


@app.route("/api/upload-template", methods=["POST"])
def upload_template():
    """上传模板文件，检测市场。"""
    if "file" not in request.files:
        return jsonify({"error": "未上传文件"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "文件名无效"}), 400

    filename = secure_filename(f.filename)
    save_path = os.path.join(TEMPLATE_DIR, filename)
    f.save(save_path)

    detected = _detect_market_from_template(save_path)
    market_info = MARKET_NAMES.get(detected, (None, None)) if detected else (None, None)

    return jsonify({
        "filename": filename,
        "detected_market": detected,
        "market_name": market_info[0],
        "market_lang": market_info[1],
    })


@app.route("/api/markets", methods=["GET"])
def list_markets():
    """列出所有可用市场。"""
    result = {}
    for market, keys in MARKET_KEYS.items():
        cid = os.environ.get(keys[0], "").strip()
        name, lang = MARKET_NAMES.get(market, (market, "EN"))
        result[market] = {"name": name, "lang": lang, "has_creds": bool(cid)}
    return jsonify(result)


@app.route("/api/detect-market", methods=["POST"])
def detect_market():
    """从 SKU / 模板文件名 / 产品数据自动检测市场。"""
    data = request.json or {}
    template_name = data.get("template_filename", "")
    sku = data.get("sku", "")

    # 优先用模板文件名
    if template_name:
        detected = _detect_market_from_template(template_name)
        if detected:
            name, lang = MARKET_NAMES.get(detected, (detected, "EN"))
            return jsonify({"market": detected, "name": name, "lang": lang, "source": "template"})

    # US SKU 前缀 heuristic
    if sku.startswith("W1") or sku.startswith("B2"):
        return jsonify({"market": "US", "name": "Amazon.com (美国)", "lang": "EN", "source": "sku"})

    # 默认 DE_TAX
    return jsonify({"market": "DE_TAX", "name": "Amazon.de (德国·含税)", "lang": "DE", "source": "default"})


@app.route("/api/run-pipeline", methods=["POST"])
def run_pipeline():
    """主流程：GIGA 取数 → AI 优化 → 填入 Excel"""
    data = request.json or {}
    sku  = (data.get("sku") or "").strip()
    market = data.get("market", "DE_TAX")
    template_name = data.get("template_filename", "")
    image_strategy = data.get("image_strategy", "use_giga")

    if not sku:
        return jsonify({"error": "SKU 不能为空"}), 400

    if not template_name:
        template_name = MARKET_TEMPLATES.get(market, "PLANTER-de.xlsm")

    steps = []

    # Step 1: GIGA 取数
    try:
        product = giga_fetch_product(sku, market)
        steps.append({"step": "fetch", "status": "ok", "sku": sku, "product_name": product.get("productName", "")[:80]})
    except Exception as e:
        steps.append({"step": "fetch", "status": "error", "message": str(e)})
        return jsonify({"error": f"GIGA 取数失败: {e}", "steps": steps}), 400

    # Step 2: AI 文案优化
    try:
        ai_result = ai_generate_copy(product, market)
        steps.append({
            "step": "ai_copy",
            "status": "ok",
            "title": ai_result.get("title", "")[:80],
            "bullets_count": len(ai_result.get("bullets", [])),
            "description_len": len(ai_result.get("description") or ""),
        })
    except Exception as e:
        steps.append({"step": "ai_copy", "status": "error", "message": str(e)})
        return jsonify({"error": f"AI 文案生成失败: {e}", "steps": steps}), 400

    # Step 3: 填入 Excel
    try:
        out_path = fill_excel(product, ai_result, market, template_name, image_strategy=image_strategy)
        steps.append({"step": "fill", "status": "ok", "output": os.path.basename(out_path)})
    except Exception as e:
        steps.append({"step": "fill", "status": "error", "message": str(e)})
        return jsonify({"error": f"Excel 填入失败: {e}", "steps": steps}), 400

    return jsonify({
        "success": True,
        "steps": steps,
        "result": {
            "sku": sku,
            "market": market,
            "market_name": MARKET_NAMES.get(market, (market, ""))[0],
            "ai_title": ai_result.get("title", ""),
            "ai_bullets": ai_result.get("bullets", []),
            "ai_description": ai_result.get("description", ""),
            "ai_search_terms": ai_result.get("search_terms", ""),
            "product_name": product.get("productName", ""),
            "image_count": len(product.get("imageUrls") or []),
            "output_file": os.path.basename(out_path),
        },
    })


@app.route("/api/fetch-only", methods=["POST"])
def fetch_only():
    """仅取数，不 AI 优化（用于预览）"""
    data = request.json or {}
    sku   = (data.get("sku") or "").strip()
    market = data.get("market", "DE_TAX")

    if not sku:
        return jsonify({"error": "SKU 不能为空"}), 400

    try:
        product = giga_fetch_product(sku, market)
        imgs = product.get("imageUrls") or []
        return jsonify({
            "success": True,
            "product": {
                "sku": product.get("sku", ""),
                "productName": product.get("productName", ""),
                "material": product.get("mainMaterial", ""),
                "color": product.get("attributes", {}).get("Main Color") or product.get("mainColor") or "",
                "dimensions": f"{product.get('assembledLength','?')} x {product.get('assembledWidth','?')} x {product.get('assembledHeight','?')} cm",
                "imageUrls": imgs,
                "imageCount": len(imgs),
                "category": product.get("category", ""),
            },
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/generate-image", methods=["POST"])
def generate_image():
    """通过 image-studio server 生成 AI 图片。"""
    data = request.json or {}
    product_data = data.get("product", {})
    template    = data.get("template", "main-white")   # main-white | main-other | aplus
    image_urls  = data.get("imageUrls", [])[:4]

    status = _check_image_studio_server()
    if not status["ok"]:
        return jsonify({"error": "image-studio server 未运行"}), 503
    if status["providers"].get("laozhang") != "configured":
        return jsonify({"error": "laozhang API Key 未配置"}), 503

    # proxy images
    ref_b64 = []
    for url in image_urls:
        b64 = _proxy_image(url)
        if b64:
            ref_b64.append(b64)

    prompts = {
        "main-white": "Product on pure white background, centered, professional photography, no shadows, no reflections, high detail, commercial quality",
        "main-other": "Product in lifestyle setting, non-white background, soft natural lighting, warm atmosphere, professional e-commerce photography",
        "aplus": "Lifestyle product shot, clean and modern setting, soft natural lighting, professional e-commerce photography, detailed composition",
    }
    base = prompts.get(template, prompts["main-other"])
    title = (product_data.get("productName") or "")[:200]
    attrs = product_data.get("attributes", {})
    color = attrs.get("Main Color") or product_data.get("mainColor") or ""
    mat   = product_data.get("mainMaterial", "")

    prompt = f"""You are a professional e-commerce product photographer creating a high-conversion listing image for Amazon/Walmart.

## PRODUCT IDENTITY (ABSOLUTE — NEVER VIOLATE)
- Product color, shape, surface texture, and key design features MUST remain EXACTLY as shown in the reference images.
- Do NOT alter any product attributes — color, material, structure, proportions, or details.
- The user's scene/style preferences only apply to the BACKGROUND, LIGHTING, and COMPOSITION — never to the product itself.

## PRODUCT INFO
- Product: {title}
- Color: {color}
- Material: {mat}

## SCENE DIRECTIVE
{base}

## OUTPUT SPECIFICATION
- Aspect ratio: 1:1 (1600x1600px)
- Lighting: soft, even, natural
- Background: clean white or minimal solid
- Quality: high detail, sharp focus, realistic materials, accurate colors
- Forbidden: watermarks, text, logos, UI elements, celebrities, brand names"""

    try:
        resp = requests.post(
            f"{IMAGE_STUDIO_BASE}/api/generate-image",
            json={"prompt": prompt, "referenceImages": ref_b64, "size": "1600x1600", "imageSize": "1024x1024"},
            timeout=120,
        )
        resp.raise_for_status()
        raw = resp.json()
    except Exception as e:
        return jsonify({"error": f"图片生成失败: {e}"}), 500

    try:
        images = raw.get("data", {}).get("images", [])
        if not images:
            images = (raw.get("data", {}).get("choices", [{}])[0].get("message", {}).get("content") or "")
            if isinstance(images, str):
                images = [{"base64": images}]
        if images and isinstance(images[0], dict):
            b64 = images[0].get("base64", "")
            data_url = f"data:image/jpeg;base64,{b64}"
            return jsonify({"success": True, "imageUrl": data_url, "template": template})
    except (KeyError, IndexError, TypeError):
        pass

    return jsonify({"error": "无法解析图片响应"}), 500


# ─────────────────────────────────────────────────────────────────
# 启动
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"  GIGAB2B Web App")
    print(f"  ={'='*50}")
    print(f"  Backend:  http://localhost:{PORT}")
    print(f"  Frontend: http://localhost:5173")
    print(f"  ={'='*50}")

    studio = _check_image_studio_server()
    print(f"  image-studio: {'OK' if studio['ok'] else '未运行'}")
    print(f"  MiniMax:      {studio.get('providers',{}).get('minimax','unknown')}")
    print(f"  laozhang:     {studio.get('providers',{}).get('laozhang','unknown')}")

    has_giga = bool(os.environ.get("GIGA_DE_TAX_CLIENT_ID"))
    print(f"  GIGA 凭证:    {'OK' if has_giga else '未配置（检查.env）'}")
    print()
    app.run(host="0.0.0.0", port=PORT, debug=True)
