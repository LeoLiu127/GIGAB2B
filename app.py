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
import json
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

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from werkzeug.utils import secure_filename
import openpyxl

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
CORS(app, resources={r"/api/*": {"origins": "*"}})
CORS(app, resources={r"/outputs/*": {"origins": "*"}})

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)


@app.route("/outputs/<path:filename>", methods=["GET"])
def serve_output_image(filename):
    """提供 outputs/ 下的生成图访问。"""
    from flask import send_from_directory
    return send_from_directory(OUTPUT_DIR, filename)

PORT = 5182

# ─────────────────────────────────────────────────────────────────
# AI 生图 Provider — 直接调 laozhang（不再依赖 image-studio server）
# ─────────────────────────────────────────────────────────────────

LAOZHANG_CONFIG = {
    "api_key": os.getenv("LAOZHANG_API_KEY", "").strip(),
    "api_url": os.getenv("LAOZHANG_API_URL", "https://api.laozhang.ai/v1").strip(),
    "model":   os.getenv("LAOZHANG_IMAGE_MODEL", "gemini-3.1-flash-image-preview").strip(),
}


def _check_laozhang_provider() -> dict:
    """检查 laozhang provider 是否就绪（仅读 env，不发起网络请求）。"""
    return {
        "configured": bool(LAOZHANG_CONFIG["api_key"]),
        "model": LAOZHANG_CONFIG["model"],
    }


def _proxy_image(url: str) -> str | None:
    """下载远程图片并转 data URL（避免 base64 损失），带回 Referer UA。"""
    try:
        parsed = requests.utils.urlparse(url)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Referer": f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else "",
        }
        r = requests.get(url, headers=headers, timeout=30, stream=True)
        if r.status_code != 200:
            return None
        buf = b""
        for chunk in r.iter_content(chunk_size=64 * 1024):
            if chunk:
                buf += chunk
            if len(buf) > 50 * 1024 * 1024:
                return None  # 50MB 上限
        content_type = r.headers.get("content-type", "image/jpeg").split(";")[0].strip() or "image/jpeg"
        b64 = base64.b64encode(buf).decode("ascii")
        return f"data:{content_type};base64,{b64}"
    except Exception:
        return None


def _generate_image_local(prompt: str, reference_b64: list[str], size: str, image_size: str) -> dict:
    """本地调用 laozhang API 生成图片（移植自 image-studio/server.cjs）。

    返回 { ok: bool, data?: dict, error?: str }
    """
    if not LAOZHANG_CONFIG["api_key"]:
        return {"ok": False, "error": "laozhang API key 未配置（在 GIGAB2B/.env 中设置 LAOZHANG_API_KEY）"}

    try:
        content = []
        for img in reference_b64:
            if isinstance(img, str) and len(img) > 100:
                content.append({"type": "image_url", "image_url": {"url": img}})
        content.append({"type": "text", "text": prompt})

        body = {
            "model": LAOZHANG_CONFIG["model"],
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 4096,
        }

        # aspectRatio + imageSize → imageConfig（与 image-studio server.cjs 一致）
        aspect_ratio_map = {
            "1600x1600": "1:1",
            "1464x600":  "1464:600",   # 非常用比例，下游可能不支持，回落到 21:9 或 closest
            "1200x900":  "4:3",
            "2000x1000": "2:1",
        }
        ar = aspect_ratio_map.get(size, "1:1")
        body["imageConfig"] = {"aspectRatio": ar, "imageSize": image_size}

        url = f"{LAOZHANG_CONFIG['api_url']}/chat/completions"
        resp = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LAOZHANG_CONFIG['api_key']}",
            },
            json=body,
            timeout=180,
        )

        if resp.status_code != 200:
            err_text = (resp.text or "")[:500]
            return {"ok": False, "error": f"laozhang API 错误: HTTP {resp.status_code}", "detail": err_text}

        return {"ok": True, "data": resp.json()}
    except requests.exceptions.Timeout:
        return {"ok": False, "error": "laozhang API 超时（180s）"}
    except Exception as e:
        return {"ok": False, "error": f"laozhang 调用异常: {e}"}


def _parse_laozhang_response(raw: dict) -> str:
    """从 laozhang 响应里提取第一张图片的 base64 / data URL。

    兼容多种返回结构：
    1) data.images = [{base64|data_url}, ...]
    2) data.choices[0].message.content = 字符串（纯 base64 或 markdown 含 ![](data:...)）
    3) data.choices[0].message.content = 列表（OpenAI multimodal 多 content 项）
    """
    try:
        d = raw.get("data", raw) or {}

        # 形态 1：data.images
        images = d.get("images")
        if images and isinstance(images, list):
            first = images[0]
            if isinstance(first, dict):
                out = first.get("base64", "") or first.get("data_url", "") or first.get("b64_json", "") or ""
                if out:
                    return out if out.startswith("data:") else f"data:image/jpeg;base64,{out}"

        # 形态 2/3：data.choices[0].message.content
        choices = d.get("choices") or []
        if choices:
            msg = choices[0].get("message", {}) or {}
            content = msg.get("content")

            # content 是字符串：可能是纯 base64、或 markdown 含 data URL
            if isinstance(content, str):
                m = re.search(r"(data:image/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+)", content)
                if m:
                    return m.group(1)
                # 纯 base64 大字符串
                if len(content) > 200 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", content):
                    return f"data:image/jpeg;base64,{content.strip()}"
                return ""

            # content 是列表（多模态 content items）
            if isinstance(content, list):
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    # OpenAI image_url 形态
                    if "image_url" in item:
                        url = item["image_url"]
                        if isinstance(url, dict):
                            url = url.get("url", "")
                        if isinstance(url, str) and url.startswith("data:"):
                            return url
                        if isinstance(url, str) and url:
                            return f"data:image/jpeg;base64,{url}"
                    # inline_data 形态（Gemini 风格）
                    if "inline_data" in item:
                        inline = item["inline_data"] or {}
                        b64 = inline.get("data", "")
                        mime = inline.get("mime_type", "image/jpeg")
                        if b64:
                            return f"data:{mime};base64,{b64}"
                    # b64_json 形态
                    if item.get("type") == "image" or "b64_json" in item:
                        b64 = item.get("b64_json") or item.get("base64") or ""
                        if b64:
                            return b64 if b64.startswith("data:") else f"data:image/jpeg;base64,{b64}"
                return ""
    except (KeyError, IndexError, TypeError):
        pass
    return ""

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


def _strip_think_blocks(text: str) -> str:
    """去除 reasoning 模型（如 MiniMax M3）的 思考过程 块。
    常见格式：<think>...</think> （可能多段）。

    关键：处理 "有开标签但无闭标签" 的截断情况——
    这种情况下, 正文被 max_tokens 截断, 但思考过程已被"挤掉",
    应该保留 think 块后面的所有正文, 而不是把整段都当 think 剥掉。
    """
    # 1. 匹配完整闭合的 <think>...</think> 块（最常见）
    text = re.sub(r"<\s*think\s*>.*?<\s*/\s*think\s*>", "", text, flags=re.DOTALL | re.IGNORECASE)
    # 2. 兼容 <think>reasoning 变体
    text = re.sub(r"<\s*(?:reasoning|thought|reflection)\s*>.*?<\s*/\s*(?:reasoning|thought|reflection)\s*>",
                  "", text, flags=re.DOTALL | re.IGNORECASE)
    # 3. 关键：处理被 max_tokens 截断的情况
    #    如果有 <think> 但没有 </think> 出现,把 <think> 这一行单独剥掉
    #    （思考块通常在开头第一段，用换行符切）
    text = re.sub(
        r"<\s*think\s*>.*?(?=\n###|\n\*\*|\n[A-ZÄÖÜ][a-zäöüß]+\s*\n|\Z)",
        "", text, flags=re.DOTALL | re.IGNORECASE
    )
    return text


def _strip_md(text: str) -> str:
    """去除行首 markdown 标记 (#, **, * 等)。"""
    text = re.sub(r"^#{1,6}\s*", "", text)
    text = re.sub(r"^\*\*\s*|\s*\*\*$", "", text)
    text = re.sub(r"^[\*\-\•]\s+", "", text)
    return text.strip()


def _strip_wrapping_quotes(text: str) -> str:
    """去除首尾成对的中英引号（包括嵌套引号）。"""
    t = text
    # 最多剥 3 层嵌套引号
    for _ in range(3):
        if len(t) >= 2 and t[0] == t[-1] and t[0] in '"\'""''':
            t = t[1:-1].strip()
        else:
            break
    return t


def _section_blocks(text: str) -> dict:
    """按 ### / ## 标题切分原文，返回 {标题小写: 正文} 字典。
    忽略空标题、纯符号标题、长度 < 2 的标题。
    """
    blocks: dict[str, str] = {}
    # 用 ### 或 ## 作为切分标记
    parts = re.split(r"(?m)^#{1,3}\s+(.+?)\s*$", text)
    # parts 形如 [前言, 标题1, 正文1, 标题2, 正文2, ...]
    i = 1
    while i < len(parts) - 1:
        heading = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        body = re.split(r"(?m)^---+\s*$", body)[0]
        key = heading.lower()
        if len(key) >= 2 and not re.match(r"^[\W_]+$", key):
            # 同名标题：保留较长的那个（AI 有时会重复）
            if key not in blocks or len(body.strip()) > len(blocks[key]):
                blocks[key] = body
        i += 2
    return blocks


def _first_meaningful_line(body: str, min_len: int = 5, strip_think: bool = True) -> str:
    """取 body 的第一个非空、非纯符号的行，去掉 markdown 标记和首尾引号。
    如果 strip_think=True，会跳过任何含  等思考残留的行。
    """
    for line in body.splitlines():
        s = _strip_md(line)
        if not s:
            continue
        if len(s) < min_len:
            continue
        if re.match(r"^[\[\]（）()\s]+$", s):
            continue
        # 跳过包含未剥干净的思考标记的行
        if strip_think and re.search(r"</?\s*(think|reasoning|thought)\s*>", s, re.IGNORECASE):
            continue
        return s
    return ""


def _parse_copy_response(raw: dict) -> dict:
    """稳健版：从 AI 返回中解析 title / bullets / description / search_terms。

    策略：
    0. 剥掉 reasoning 模型（如 MiniMax M3）的  思考过程 块
    1. 拿到 choices[0].message.content
    2. 按 ### / ## 标题切分到 blocks dict（同名取最长）
    3. 在 blocks 中按"标题同义词"匹配到正文
    4. title / search_terms 取首个有效行（剥引号）；bullets 按空行切分；description 拼所有有效行
    5. 全部失败时回退到正则全文兜底
    """
    result = {"title": "", "bullets": [], "description": "", "search_terms": ""}
    try:
        content = raw.get("data", {}).get("choices", [{}])[0].get("message", {}).get("content", "")
    except (KeyError, IndexError, TypeError):
        return result
    if not content:
        return result

    # 0. 剥掉  思考块（MiniMax M3 等 reasoning 模型会输出）
    content = _strip_think_blocks(content)

    blocks = _section_blocks(content)

    # ── 标题同义词表（支持中英德法） ──
    TITLE_KEYS = [
        "product title", "title", "produkttitel", "titre du produit",
        "产品标题", "商品标题", "titre",
    ]
    BULLET_KEYS = [
        "five bullet points", "five bullets", "bullet points", "bullets",
        "fünf kernpunkte", "kernpunkte", "bullet points",
        "cinq points clés", "points clés", "cinq puces",
        "五点描述", "五点要点", "五点", "产品要点",
    ]
    DESC_KEYS = [
        "product description", "description", "produktbeschreibung",
        "description du produit",
        "产品描述", "商品描述", "产品介绍",
    ]
    ST_KEYS = [
        "search terms", "suchbegriffe", "mots-clés", "mots cles",
        "搜索词", "搜索关键词", "关键词",
    ]

    def find_block(keys: list[str]) -> str:
        # 先精确匹配（小写）
        for k in keys:
            if k in blocks:
                return blocks[k]
        # 再 contains 匹配
        for bk, bv in blocks.items():
            for k in keys:
                if k in bk or bk in k:
                    return bv
        return ""

    # ── Title ──
    tb = find_block(TITLE_KEYS)
    if tb:
        result["title"] = _strip_wrapping_quotes(_first_meaningful_line(tb, min_len=5))
    if not result["title"]:
        # 兜底：在全文找 "Title:" 之类的前缀
        m = re.search(r"(?:^|\n)(?:Product\s*Title|Titre|Titel|Title)[：:]\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
        if m:
            result["title"] = _strip_wrapping_quotes(_strip_md(m.group(1)))

    # ── Bullets ──
    bb = find_block(BULLET_KEYS)
    if bb:
        # 按空行切；每段开头可能有 "1." "2." 或 "-" "*" 标记，去掉
        parts = re.split(r"\n\s*\n", bb)
        bullets = []
        for p in parts:
            # 段内多行合并
            lines = [_strip_md(l) for l in p.splitlines() if _strip_md(l)]
            if not lines:
                continue
            # 去掉首行的 "1." "1）" "- " "* "
            head = lines[0]
            head = re.sub(r"^\d{1,2}\s*[.．)）]\s*", "", head)
            head = re.sub(r"^[\-\•\*]\s+", "", head)
            lines[0] = head.strip()
            text = " ".join(l for l in lines if l).strip()
            text = _strip_wrapping_quotes(text)
            # 过滤：太短的、明显是"标题提示"而不是 bullet 的
            # 例如 "Product Title (max 200 characters, German)"
            if len(text) < 30:
                continue
            if re.match(r"^[A-Z][\w\s\(\)]{0,40}$", text) and "(" in text and "character" in text.lower():
                continue
            # 过滤明显的小标题/章节名（不是 bullet，是用户问句/章节描述）
            if re.match(r"^[A-Z][^.]*$", text) and len(text.split()) <= 6 and not re.search(r"[a-zäöüß]{4,}", text):
                continue
            bullets.append(text)
            if len(bullets) >= 5:
                break
        if bullets:
            result["bullets"] = bullets
    if not result["bullets"]:
        # 兜底：抓全文中所有 "1. xxx" "2. xxx" 形式（行内）
        matches = re.findall(r"(?:^|\n)\s*(?:\d{1,2}\s*[.．)）]\s*|[\-\•\*]\s+)([^\n]{30,400})", content)
        if matches:
            result["bullets"] = [_strip_wrapping_quotes(_strip_md(m)) for m in matches[:5] if _strip_md(m)]

    # ── Description ──
    db = find_block(DESC_KEYS)
    if db:
        lines = []
        for raw_line in db.splitlines():
            s = _strip_md(raw_line)
            if not s:
                continue
            if re.match(r"^[\[\]（）()\s]+$", s):
                continue
            # 跳过包含未剥干净的思考标记
            if re.search(r"</?\s*(think|reasoning|thought)\s*>", s, re.IGNORECASE):
                continue
            lines.append(s)
        result["description"] = "\n".join(lines).strip()

    # Fallback: 如果 description 为空，从 bullets 拼一段占位（HTML 格式，符合 Amazon）
    if not result["description"] and result["bullets"]:
        result["description"] = "<b>Produktmerkmale:</b><br>\n" + \
            "<br>\n".join(f"<li>{b}</li>" for b in result["bullets"])

    # Fallback: 如果 search_terms 为空但 title 有，按产品名生成基础搜索词
    if not result["search_terms"] and result["title"]:
        # 提取 title 中的关键词（按空格切，去短词）
        words = [w.strip(".,;:()") for w in result["title"].split() if len(w) > 3]
        result["search_terms"] = ", ".join(words[:15])

    # ── Search Terms ──
    sb = find_block(ST_KEYS)
    if sb:
        st = _strip_wrapping_quotes(_first_meaningful_line(sb, min_len=3))
        # 如果第一行像"Search Terms - xxx"这种描述而不是真正的关键词列表，跳过找下一行
        if re.match(r"^[A-Za-z\s\-–]+$", st) and "," not in st and len(st.split()) <= 8:
            for line in sb.splitlines()[1:]:
                s2 = _strip_wrapping_quotes(_strip_md(line))
                if s2 and "," in s2:
                    st = s2
                    break
        result["search_terms"] = st[:300]
    if not result["search_terms"]:
        m = re.search(r"(?:Search\s*Terms|Suchbegriffe|Mots[-\s]?[Cc]lés?)[：:]\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
        if m:
            result["search_terms"] = _strip_wrapping_quotes(_strip_md(m.group(1)))[:300]

    return result


def _dump_ai_response(sku: str, market: str, raw: dict, parsed: dict) -> None:
    """把 AI 原始响应 + 解析结果写入 .logs/ai_response_<sku>_<market>.txt。
    排错时直接看这个文件就知道 AI 返回了什么、解析器抽到了什么。

    兼容两种 raw 格式:
      - 旧 image-studio: {"success": ..., "data": {"choices": [...]}}
      - 新 _generate_text_local: {"choices": [...], "usage": ...}
    """
    import json as _json
    try:
        log_dir = os.path.join(os.path.dirname(__file__), ".logs")
        os.makedirs(log_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d-%H%M%S")
        path = os.path.join(log_dir, f"ai_response_{sku}_{market}_{ts}.txt")
        # 解包可能存在的 {success, data} 外层(旧 image-studio 格式)
        actual = raw.get("data", raw) if isinstance(raw.get("data"), dict) else raw
        # 提取 content + reasoning_content(reasoning 模型诊断用)
        content = ""
        reasoning = ""
        try:
            choices = actual.get("choices") or [{}]
            msg = choices[0].get("message") or {}
            content = msg.get("content") or ""
            reasoning = msg.get("reasoning_content") or ""
            if not content:
                content = choices[0].get("text") or ""
        except (KeyError, IndexError, TypeError):
            pass
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"=== SKU: {sku} | Market: {market} | Time: {ts} ===\n\n")
            f.write("--- RAW AI content (text) ---\n")
            f.write(content if content else "(empty)\n")
            f.write("\n--- RAW AI reasoning_content ---\n")
            f.write(reasoning if reasoning else "(none)\n")
            f.write("\n--- RAW AI FULL JSON ---\n")
            try:
                f.write(_json.dumps(actual, ensure_ascii=False, indent=2)[:8000])
            except Exception:
                f.write(str(actual)[:8000])
            f.write("\n\n--- PARSED ---\n")
            f.write(f"title:        {parsed.get('title','')!r}\n")
            f.write(f"bullets:      {len(parsed.get('bullets',[]))} items\n")
            for i, b in enumerate(parsed.get("bullets", []), 1):
                f.write(f"  [{i}] {b}\n")
            f.write(f"description:  {len(parsed.get('description','') or '')} chars\n")
            f.write(f"search_terms: {parsed.get('search_terms','')!r}\n")
            ai_st = parsed.get("_ai_status", "")
            if ai_st:
                f.write(f"ai_status:    {ai_st}\n")
    except Exception as e:
        print(f"[dump_ai_response] 写入日志失败: {e}")


MINIMAX_CONFIG = {
    "api_key": os.getenv("MINIMAX_API_KEY", "").strip(),
    "api_url": os.getenv("MINIMAX_API_URL", "https://api.minimaxi.com/v1").strip(),
    "model":   os.getenv("MINIMAX_MODEL", "MiniMax-M3").strip(),
}


def _extract_ai_text(data: dict) -> str:
    """从 AI 响应中提取正文,兼容 reasoning 模型。

    兼容顺序:
      1. choices[0].message.content       — OpenAI 标准
      2. choices[0].message.reasoning_content — reasoning 模型(部分 provider)
      3. choices[0].text                  — 旧式 completions 端点
    """
    try:
        choices = data.get("choices") or [{}]
        msg = (choices[0].get("message") or {})
        # 1. 标准 content
        content = msg.get("content")
        if content and content.strip():
            return content
        # 2. reasoning_content 兜底(reasoning 模型常把正文放这里)
        rc = msg.get("reasoning_content")
        if rc and rc.strip():
            return rc
        # 3. 旧式 text 字段
        return choices[0].get("text", "") or ""
    except (AttributeError, IndexError, TypeError):
        return ""


def _generate_text_local(prompt: str, model: str = "minimax", max_tokens: int = 8192,
                          max_retries: int = 2) -> dict:
    """本地调 AI 文案模型（移植自 image-studio/server.cjs）。

    返回 { ok: bool, content?: str, error?: str, attempts?: int }
    """
    cfg = MINIMAX_CONFIG if model == "minimax" else None
    if cfg is None:
        return {"ok": False, "error": f"不支持的 model: {model}"}
    if not cfg["api_key"]:
        return {"ok": False, "error": f"{model} API key 未配置（在 GIGAB2B/.env 中设置 MINIMAX_API_KEY）"}

    url = f"{cfg['api_url']}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg['api_key']}",
    }
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }

    last_error = ""
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=120)
            if resp.status_code != 200:
                err_text = (resp.text or "")[:500]
                last_error = f"{model} API 错误: HTTP {resp.status_code}: {err_text}"
                if resp.status_code in (429, 500, 502, 503, 504):
                    # 可重试的状态码:等 1.5s 后重试
                    import time
                    time.sleep(1.5 * attempt)
                    continue
                # 不可重试:4xx 业务错误
                return {"ok": False, "error": last_error, "attempts": attempt}

            data = resp.json()
            content = _extract_ai_text(data)
            if content and content.strip():
                return {"ok": True, "content": content, "raw": data, "attempts": attempt}
            # 空响应:可能是 reasoning 模型冷启动 / quota 抖动,等一下重试
            last_error = "AI 返回空内容(reasoning 模型可能延迟返回,稍后重试)"
            if attempt < max_retries:
                import time
                time.sleep(2.0 * attempt)
                continue
        except requests.exceptions.Timeout:
            last_error = f"{model} API 超时（120s）"
            if attempt < max_retries:
                continue
        except Exception as e:
            last_error = f"{model} 调用异常: {e}"
            break

    return {"ok": False, "error": last_error, "attempts": max_retries}


def ai_generate_copy(product: dict, market: str) -> dict:
    """直接本地调 MiniMax M3 生成 Listing 文案（不再依赖 image-studio server）。

    返回的 dict 额外带 _ai_status 字段:
      - "ok":      内容齐全
      - "partial": 解析后部分字段为空(例如 bullets 缺失但 title 在)
      - "empty":   AI 返回了内容但解析后全部为空(基本等于失败)
    """
    if not MINIMAX_CONFIG["api_key"]:
        raise RuntimeError(
            "MiniMax API Key 未配置（在 GIGAB2B/.env 中设置 MINIMAX_API_KEY）"
        )

    prompt = _build_copy_prompt(product, market)
    gen = _generate_text_local(prompt, model="minimax")
    if not gen["ok"]:
        attempts = gen.get("attempts", 1)
        raise RuntimeError(
            f"MiniMax 生成失败(已重试 {attempts} 次): {gen.get('error', 'unknown')}"
        )

    # 兼容旧 image-studio 响应形态：包一层 { success, data } 再交给解析器
    wrapped = {"success": True, "data": gen["raw"]}
    parsed = _parse_copy_response(wrapped)

    # 评估解析结果质量
    title_ok = bool((parsed.get("title") or "").strip())
    bullets_count = len(parsed.get("bullets") or [])
    desc_ok = bool((parsed.get("description") or "").strip())
    st_ok = bool((parsed.get("search_terms") or "").strip())
    filled = sum([title_ok, bullets_count > 0, desc_ok, st_ok])
    if filled == 4:
        parsed["_ai_status"] = "ok"
    elif filled == 0:
        parsed["_ai_status"] = "empty"
    else:
        parsed["_ai_status"] = "partial"

    parsed["_ai_attempts"] = gen.get("attempts", 1)
    _dump_ai_response(product.get("sku", "unknown"), market, gen["raw"], parsed)
    return parsed


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


def fill_excel(product: dict, ai_result: dict, market: str, template_name: str, row: int = 7, image_strategy: str = "use_giga", image_overrides: dict | None = None) -> str:
    """将产品数据 + AI 优化写入 Excel，返回输出文件路径。

    image_overrides: { "main": "/outputs/xxx.jpg", "pt1": "/outputs/yyy.jpg", ... }
                    缺失的槽位用 GIGA 原图。
    """
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

    # 槽位顺序：main, pt1..pt8
    slot_names = ["main", "pt1", "pt2", "pt3", "pt4", "pt5", "pt6", "pt7", "pt8"]
    overrides = image_overrides or {}
    slot_urls: list[str] = []
    for i, name in enumerate(slot_names):
        if name in overrides and overrides[name]:
            slot_urls.append(overrides[name])
        elif i < len(imgs):
            slot_urls.append(imgs[i])
        else:
            slot_urls.append("")

    w(COL_MAP["sku"],             product.get("sku", ""))
    w(COL_MAP["product_type"],   "PLANTER")
    w(COL_MAP["sku2"],           "full_update")
    w(COL_MAP["product_name"],   ai_result.get("title") or product.get("productName", ""))
    w(COL_MAP["mpn"],            product.get("mpn", ""))
    w(COL_MAP["manufacturer"],   "YUDA HOME FURNITURE")

    if slot_urls and slot_urls[0]:
        w(COL_MAP["main_image"], slot_urls[0])
    for i, url in enumerate(slot_urls[1:9], start=25):
        if url:
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
    laozhang = _check_laozhang_provider()
    has_giga = bool(os.environ.get("GIGA_DE_TAX_CLIENT_ID"))
    return jsonify({
        "status": "ok",
        "laozhang": laozhang,
        "has_giga_creds": has_giga,
        "port": PORT,
    })


@app.route("/api/server-status", methods=["GET"])
def server_status():
    """检查 AI providers（laozhang 生图 + minimax 文案）和 GIGA 凭证状态。"""
    laozhang = _check_laozhang_provider()
    minimax_ok = bool(MINIMAX_CONFIG["api_key"])
    # 保持前端兼容：image_studio 字段返回 ok / providers（minimax + laozhang）
    image_studio = {
        "ok": True,
        "providers": {
            "laozhang": "configured" if laozhang["configured"] else "missing",
            "minimax":  "configured" if minimax_ok else "missing",
        },
        "model": laozhang["model"],
        "text_model": MINIMAX_CONFIG["model"],
    }
    giga_status = {}
    for market, keys in MARKET_KEYS.items():
        cid = os.environ.get(keys[0], "").strip()
        giga_status[market] = bool(cid)
    return jsonify({
        "image_studio": image_studio,
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
    """主流程：GIGA 取数 → AI 优化 → 填入 Excel

    流式响应（SSE）：每完成一步 emit 一条 ``data: <json>\\n\\n``，
    最后一条 status=done / error。客户端可在任意时刻拿到完整 steps 并停止 spinner。
    """
    data = request.json or {}
    sku  = (data.get("sku") or "").strip()
    market = data.get("market", "DE_TAX")
    template_name = data.get("template_filename", "")
    image_strategy = data.get("image_strategy", "use_giga")

    def _emit(payload: dict):
        # 把每一步推到响应体，格式与之前一次返回的 steps[] 保持一致（status=running 表示进行中）
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    if not sku:
        return jsonify({"error": "SKU 不能为空"}), 400

    if not template_name:
        template_name = MARKET_TEMPLATES.get(market, "PLANTER-de.xlsm")

    # 必须延迟 stream 初始化到确定有数据要发之后 — 一些 wsgi 服务器会丢弃空响应
    def _gen():
        try:
            steps = []

            # Step 1: GIGA 取数
            yield _emit({"type": "step", "status": "running", "step": "fetch", "label": "GIGA 取数"})
            try:
                product = giga_fetch_product(sku, market)
                step_info = {"step": "fetch", "status": "ok", "sku": sku, "product_name": (product.get("productName") or "")[:80]}
                steps.append(step_info)
                yield _emit({"type": "step", **step_info})
            except Exception as e:
                err = {"step": "fetch", "status": "error", "message": str(e)}
                steps.append(err)
                yield _emit({"type": "step", **err})
                yield _emit({"type": "error", "status": "error", "error": f"GIGA 取数失败: {e}", "steps": steps})
                return

            # Step 2: AI 文案优化
            yield _emit({"type": "step", "status": "running", "step": "ai_copy", "label": "AI 文案生成"})
            try:
                ai_result = ai_generate_copy(product, market)
                step_info = {
                    "step": "ai_copy",
                    "status": "ok",
                    "title": (ai_result.get("title") or "")[:80],
                    "bullets_count": len(ai_result.get("bullets") or []),
                    "description_len": len(ai_result.get("description") or ""),
                }
                steps.append(step_info)
                yield _emit({"type": "step", **step_info})
            except Exception as e:
                err = {"step": "ai_copy", "status": "error", "message": str(e)}
                steps.append(err)
                yield _emit({"type": "step", **err})
                yield _emit({"type": "error", "status": "error", "error": f"AI 文案生成失败: {e}", "steps": steps})
                return

            # Step 3: 填入 Excel
            yield _emit({"type": "step", "status": "running", "step": "fill", "label": "填入 Excel"})
            try:
                out_path = fill_excel(product, ai_result, market, template_name, image_strategy=image_strategy)
                step_info = {"step": "fill", "status": "ok", "output": os.path.basename(out_path)}
                steps.append(step_info)
                yield _emit({"type": "step", **step_info})
            except Exception as e:
                err = {"step": "fill", "status": "error", "message": str(e)}
                steps.append(err)
                yield _emit({"type": "step", **err})
                yield _emit({"type": "error", "status": "error", "error": f"Excel 填入失败: {e}", "steps": steps})
                return

            # 终态：把所有 AI 生成的文案 + 产品图片 URL 一起随 done 事件返回
            ai_status = ai_result.get("_ai_status", "ok")
            ai_attempts = ai_result.get("_ai_attempts", 1)
            yield _emit({
                "type": "done",
                "status": "ok" if ai_status != "empty" else "warning",
                "ai_status": ai_status,
                "ai_attempts": ai_attempts,
                "steps": steps,
                "result": {
                    "sku": sku,
                    "market": market,
                    "market_name": MARKET_NAMES.get(market, (market, ""))[0],
                    "ai_title": ai_result.get("title", ""),
                    "ai_bullets": ai_result.get("bullets", []),
                    "ai_description": ai_result.get("description", ""),
                    "ai_search_terms": ai_result.get("search_terms", ""),
                    "ai_status": ai_status,
                    "ai_attempts": ai_attempts,
                    "product_name": product.get("productName", ""),
                    "imageUrls": product.get("imageUrls") or [],
                    "image_count": len(product.get("imageUrls") or []),
                    "output_file": os.path.basename(out_path),
                    "mainColor": product.get("attributes", {}).get("Main Color") or product.get("mainColor") or "",
                    "mainMaterial": product.get("mainMaterial", ""),
                    "texture": product.get("texture", ""),
                    "size": f"{product.get('assembledLength','?')} x {product.get('assembledWidth','?')} x {product.get('assembledHeight','?')} cm",
                    "attributes": product.get("attributes", {}),
                },
            })
        except Exception as e:
            # 兜底：流中任何未捕获异常都给客户端一个 error 事件
            yield _emit({"type": "error", "status": "error", "error": f"流水线异常: {e}"})

    return Response(_gen(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",  # nginx: 不要 buffer
        "Connection": "keep-alive",
    })


# 场景提示词模板（按 scene_type 切换基础场景描述，按 background/lighting/angle 进一步定制）
_SCENE_TYPE_BASE = {
    "white-bg":  "Product on pure white background, centered, professional photography, no shadows, no reflections, high detail, commercial quality",
    "lifestyle": "Product in lifestyle setting, non-white background, soft natural lighting, warm atmosphere, professional e-commerce photography",
    "outdoor":   "Product in outdoor setting, natural sunlight, contextual environment, professional e-commerce photography, vivid atmosphere",
    "aplus":     "Lifestyle product shot, clean and modern setting, soft natural lighting, professional e-commerce photography, detailed composition",
}
_BACKGROUND_PHRASE = {
    "pure-white": "background is pure clean white (#FFFFFF)",
    "gradient":   "background is soft gradient (light gray to white)",
    "indoor":     "background is a cozy indoor environment (living room or kitchen)",
    "outdoor":    "background is outdoor (garden, terrace, or balcony)",
}
_LIGHTING_PHRASE = {
    "soft": "lighting is soft and even, natural daylight",
    "warm": "lighting is warm, golden hour tone",
    "cool": "lighting is cool, blue-tinted",
}
_ANGLE_PHRASE = {
    "front":  "camera angle is front-facing, eye-level",
    "45deg":  "camera angle is 45-degree elevated perspective, three-quarter view",
    "top":    "camera angle is top-down, bird's eye view",
}


# 尺寸 → image-studio 的 size / imageSize 参数映射
_SIZE_MAP = {
    "1600x1600": ("1600x1600", "1024x1024"),
    "1464x600":  ("1464x600",  "1024x512"),
    "1200x900":  ("1200x900",  "1024x768"),
    "2000x1000": ("2000x1000", "1024x512"),
}


def _build_generation_prompt(image_type: str, size: str, copy: dict, product: dict, prompt_extra: str) -> tuple[str, str, str]:
    """根据 image_type + size 切换场景模板，吸收中间栏全文案 + 产品尺寸/颜色/材质/纹理。

    返回 (完整 prompt, size_param, image_size_param)。
    """
    title       = (copy.get("title") or product.get("productName") or "")[:200]
    bullets     = copy.get("bullets") or []
    description = (copy.get("description") or "")[:500]
    search      = copy.get("search_terms") or ""

    color    = product.get("mainColor") or ""
    material = product.get("mainMaterial") or ""
    texture  = product.get("texture") or ""
    size_str = product.get("size") or ""

    size_param, image_size_param = _SIZE_MAP.get(size, _SIZE_MAP["1600x1600"])

    # 场景模板：主图 vs 详情图
    if image_type == "main":
        scene_block = (
            "A single hero shot suitable as the Amazon MAIN image. "
            "Product on a clean white background, centered, occupies 80%+ of the frame. "
            "Professional studio lighting, eye-catching composition. "
            "No text, no logos, no watermarks, no people. "
            "Focus on showcasing the product's silhouette, primary color, and key visual identity."
        )
    else:  # detail
        scene_block = (
            "An A+ DETAIL / CONTEXT image showing the product in use or close-up. "
            "Lifestyle context (home, garden, or relevant scenario). "
            "Show material texture, craftsmanship details, scale, and feature highlights. "
            "Marketing-style composition that complements the main image. "
            "No text overlays, no logos."
        )

    extra_block = f"\n\n## USER ADDITIONAL REQUIREMENTS\n{prompt_extra.strip()}" if (prompt_extra and prompt_extra.strip()) else ""

    bullets_block = "\n".join(f"- {b}" for b in bullets if (b or "").strip()) if bullets else "(none)"

    prompt = f"""You are a professional e-commerce product photographer creating a high-conversion Amazon listing image.

## ABSOLUTE PRODUCT IDENTITY (NEVER VIOLATE)
The following product attributes are LOCKED and must match the reference images EXACTLY:
- DIMENSIONS / SIZE: {size_str or "(see reference image)"}
- COLOR: {color or "(see reference image)"}
- MATERIAL: {material or "(see reference image)"}
- SURFACE TEXTURE: {texture or "(see reference image)"}
- SHAPE, PROPORTIONS, KEY DESIGN FEATURES — exactly as shown in reference images

Do NOT alter, stylize, reinterpret, or invent any of the above. The user's scene/style preferences only affect BACKGROUND, LIGHTING, COMPOSITION — never the product itself.

## PRODUCT INFO
- Title: {title}
- Color: {color}
- Material: {material}
- Surface Texture: {texture}
- Dimensions: {size_str}

## MARKETING COPY (use to inform visual emphasis)
- Description: {description or "(none)"}
- Key Selling Points (from bullets):
{bullets_block}
- Search Keywords: {search or "(none)"}

## SCENE DIRECTIVE
{scene_block}

## OUTPUT SPECIFICATION
- Aspect ratio: {size}
- Lighting: soft, even, natural
- Quality: high detail, sharp focus, realistic materials, accurate colors
- Forbidden: watermarks, text, logos, UI elements, celebrities, brand names{extra_block}"""

    return prompt, size_param, image_size_param


def _save_base64_to_outputs(sku: str, slot: str, b64_or_data_url: str) -> dict:
    """保存 base64（或 data:image/...;base64,xxx）到 outputs/{sku}/，返回 { url, filename }。"""
    raw = b64_or_data_url
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    sku_safe = re.sub(r"[^\w\-]", "_", sku) or "unknown"
    slot_safe = re.sub(r"[^\w\-]", "_", slot) or "img"
    sku_dir = os.path.join(OUTPUT_DIR, sku_safe)
    os.makedirs(sku_dir, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    fname = f"{slot_safe}_{ts}.jpg"
    fpath = os.path.join(sku_dir, fname)
    img_bytes = base64.b64decode(raw)
    with open(fpath, "wb") as f:
        f.write(img_bytes)
    return {
        "url": f"/outputs/{sku_safe}/{fname}",
        "filename": fname,
    }


@app.route("/api/generate-image", methods=["POST"])
def generate_image():
    """本地调用 laozhang API 生成 AI 图片，支持自定义 prompt + 多参考图 + 槽位。

    请求体（v3）：
    {
      "slot": "main" | "detail",
      "size": "1600x1600" | "1464x600" | "1200x900" | "2000x1000",
      "prompt_extra": "附加要求文本",
      "reference_images": [
         {"source": "giga",   "index": 0, "url": "https://..."},
         {"source": "upload", "data_url": "data:image/..."}
      ],
      "sku": "W3372P314940",
      "product": { "productName", "mainColor", "mainMaterial", "texture", "size" },
      "copy":    { "title", "bullets": [...], "description", "search_terms" }
    }
    """
    data = request.json or {}

    provider = _check_laozhang_provider()
    if not provider["configured"]:
        return jsonify({"error": "laozhang API Key 未配置（在 GIGAB2B/.env 中设置 LAOZHANG_API_KEY）"}), 503

    slot = (data.get("slot") or "main").strip()
    size = (data.get("size") or "1600x1600").strip()
    prompt_extra = data.get("prompt_extra") or ""
    reference_images = data.get("reference_images") or []
    sku = (data.get("sku") or "").strip()
    product_data = data.get("product") or {}
    copy_data = data.get("copy") or {}

    # 向后兼容：旧版 product/template/imageUrls（如有）
    if not reference_images and data.get("imageUrls"):
        reference_images = [{"source": "giga", "index": i, "url": u} for i, u in enumerate(data["imageUrls"])]

    # 收集参考图 base64（本地代理下载，不再走 image-studio）
    ref_b64: list[str] = []
    for ref in reference_images[:8]:
        src = ref.get("source")
        if src == "giga":
            url = ref.get("url")
            if url:
                b64 = _proxy_image(url)
                if b64:
                    ref_b64.append(b64)
        elif src == "upload":
            du = ref.get("data_url") or ""
            if du.startswith("data:image"):
                ref_b64.append(du)

    prompt, size_param, image_size_param = _build_generation_prompt(
        image_type=slot,
        size=size,
        copy=copy_data,
        product=product_data,
        prompt_extra=prompt_extra,
    )

    # 本地调 laozhang 生成（不再依赖 image-studio server）
    gen = _generate_image_local(prompt, ref_b64, size_param, image_size_param)
    if not gen["ok"]:
        return jsonify({"error": f"图片生成失败: {gen.get('error', 'unknown')}", "detail": gen.get("detail", "")}), 500

    b64_or_data_url = _parse_laozhang_response(gen["data"])
    if not b64_or_data_url:
        return jsonify({"error": "无法解析图片响应"}), 500

    # 保存到 outputs/{sku}/ 或 outputs/
    if sku:
        saved = _save_base64_to_outputs(sku, slot, b64_or_data_url)
        image_url = saved["url"]
        filename = saved["filename"]
    else:
        image_url = b64_or_data_url if b64_or_data_url.startswith("data:") else f"data:image/jpeg;base64,{b64_or_data_url}"
        filename = ""

    return jsonify({
        "success": True,
        "slot": slot,
        "image_url": image_url,
        "thumbnail_url": image_url,
        "filename": filename,
        "size": size_param,
        "prompt_used": prompt[:2000],
    })


@app.route("/api/fetch-images", methods=["POST"])
def fetch_images():
    """获取 GIGA 产品图片（proxy 代理，返回 data URL）"""
    data = request.json or {}
    sku = (data.get("sku") or "").strip()
    market = data.get("market", "DE_TAX")

    if not sku:
        return jsonify({"error": "SKU 不能为空"}), 400

    try:
        product = giga_fetch_product(sku, market)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    raw_urls = product.get("imageUrls") or []
    result = []
    for i, url in enumerate(raw_urls[:9]):
        proxied = _proxy_image(url)
        result.append({
            "index": i,
            "originalUrl": url,
            "dataUrl": proxied or url,
            "label": f"图片 {i + 1}" if i > 0 else "主图",
        })

    return jsonify({
        "success": True,
        "sku": sku,
        "market": market,
        "images": result,
    })


# ─────────────────────────────────────────────────────────────────
# 启动
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"  GIGAB2B Web App")
    print(f"  ={'='*50}")
    print(f"  Backend:  http://localhost:{PORT}")
    print(f"  Frontend: http://localhost:5173")
    print(f"  ={'='*50}")

    laozhang = _check_laozhang_provider()
    print(f"  laozhang:     {'OK' if laozhang['configured'] else '未配置（检查 .env 中 LAOZHANG_API_KEY）'} ({laozhang['model']})")

    has_giga = bool(os.environ.get("GIGA_DE_TAX_CLIENT_ID"))
    print(f"  GIGA 凭证:    {'OK' if has_giga else '未配置（检查.env）'}")
    print()

    # debug 模式由环境变量 FLASK_DEBUG 控制，默认关闭。
    # 关闭 debug 可以避免 Flask reloader 子进程退出后 socket 残留导致端口被占。
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    if not debug_mode:
        # 显式开启 SO_REUSEADDR，配合 Windows 端口立即回收
        # threaded=True 让 SSE 长连接不再阻塞其他 API 请求（致命 F-1 修复）
        from werkzeug.serving import make_server
        import socket as _socket
        server = make_server("0.0.0.0", PORT, app, threaded=True)
        server.socket.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
        print(f"  Server:       http://localhost:{PORT}  (threaded)")
        server.serve_forever()
    else:
        print(f"  Server:       http://localhost:{PORT}  (FLASK_DEBUG=1)")
        app.run(host="0.0.0.0", port=PORT, debug=True)
