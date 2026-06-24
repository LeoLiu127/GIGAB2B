"""
AI 文案优化模块 —— 调用 image-studio 后端（MiniMax M3 文案 + laozhang/Gemini 图片）
GIGAB2B 项目专用，支持 Amazon 多语言市场（DE / UK / FR）。

依赖：pip install requests
前置条件：image-studio 项目 server.cjs 已在 localhost:5181 运行
        或设置 IMAGE_STUDIO_PATH 指向 image-studio 目录，
        脚本会自动启动/停止 server。
"""

import sys
import re
import os
import time
import subprocess
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

IMAGE_STUDIO_BASE = "http://localhost:5181"

# 自动探测 image-studio 路径
IMAGE_STUDIO_PATH = os.environ.get(
    "IMAGE_STUDIO_PATH",
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "image-studio")
    ),
)

# ────────────────────────────────────────────────────────────────
# Server 进程管理
# ────────────────────────────────────────────────────────────────

_server_proc_obj = None

def _find_server_cjs():
    """在 IMAGE_STUDIO_PATH 下查找 server.cjs。"""
    p = IMAGE_STUDIO_PATH
    candidates = [
        os.path.join(p, "server.cjs"),
        os.path.join(p, "server.js"),
        os.path.join(p, "src", "server.cjs"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def start_server(block: bool = True, timeout: int = 20) -> bool:
    """
    尝试启动 image-studio server（如果未运行）。
    block=True 会阻塞等待 server 就绪（最多 timeout 秒）。
    返回 True 表示 server 现已就绪。
    """
    global _server_proc_obj

    # 已在运行
    if check_server(quiet=True):
        return True

    server_path = _find_server_cjs()
    if not server_path:
        print(f"  [server] server.cjs 未找到: {IMAGE_STUDIO_PATH}")
        return False

    print(f"  [server] 正在启动 image-studio server...")
    print(f"           path: {server_path}")

    try:
        # 分离模式启动，不继承父进程控制台
        proc = subprocess.Popen(
            ["node", server_path],
            cwd=os.path.dirname(server_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        _server_proc_obj = proc

        if block:
            deadline = time.time() + timeout
            while time.time() < deadline:
                time.sleep(1)
                if check_server(quiet=True):
                    print("  [server] ✅ server 已就绪")
                    return True
                if proc.poll() is not None:
                    # 进程已退出
                    print("  [server] ❌ server 进程异常退出")
                    return False
            print("  [server] ⚠️ server 启动超时")
            return False
        return True

    except FileNotFoundError:
        print("  [server] ❌ node 未找到，请安装 Node.js")
        return False
    except Exception as e:
        print(f"  [server] ❌ 启动失败: {e}")
        return False


def stop_server():
    """停止由本模块启动的 server 进程。"""
    global _server_proc_obj
    if _server_proc_obj is not None:
        try:
            _server_proc_obj.terminate()
            _server_proc_obj.wait(timeout=5)
        except Exception:
            try:
                _server_proc_obj.kill()
            except Exception:
                pass
        _server_proc_obj = None


def ensure_server(ask_start: bool = True) -> bool:
    """
    确保 image-studio server 可用。
    若未运行，询问用户是否自动启动。
    """
    if check_server(quiet=True):
        return True

    if ask_start:
        try:
            choice = input("\n  image-studio server 未运行，是否自动启动？ [Y/n]: ").strip().lower()
            if choice in ("n", "no"):
                return False
        except (EOFError, KeyboardInterrupt):
            return False

    return start_server(block=True, timeout=30)


# ────────────────────────────────────────────────────────────────
# 健康检查
# ────────────────────────────────────────────────────────────────

def check_server(quiet: bool = False) -> bool:
    """检查 image-studio server 是否可达。"""
    try:
        r = requests.get(f"{IMAGE_STUDIO_BASE}/api/health", timeout=5)
        if r.status_code == 200:
            if not quiet:
                data = r.json()
                print("  image-studio server: ✅ 已连接")
                providers = data.get("aiProviders", {})
                for name, status in providers.items():
                    icon = "✅" if status == "configured" else "⚠️"
                    print(f"    {name}: {icon} {status}")
            return True
    except requests.exceptions.ConnectionError:
        if not quiet:
            print("  image-studio server: ❌ 未运行")
    except requests.exceptions.Timeout:
        if not quiet:
            print("  image-studio server: ⚠️ 连接超时")
    except Exception as e:
        if not quiet:
            print(f"  image-studio server: ⚠️ {e}")
    return False


# ────────────────────────────────────────────────────────────────
# 图片代理：将 GIGA 图片 URL 转为 base64 dataUrl
# ────────────────────────────────────────────────────────────────

def proxy_image_to_base64(image_url: str) -> str | None:
    """通过 image-studio server 代理获取图片，返回 base64 dataUrl。"""
    try:
        r = requests.get(
            f"{IMAGE_STUDIO_BASE}/api/proxy-image",
            params={"url": image_url},
            timeout=30,
        )
        if r.status_code == 200:
            data = r.json()
            if data.get("ok"):
                tag = "(已压缩) " if data.get("compressed") else ""
                w = data.get("width", "?")
                h = data.get("height", "?")
                print(f"    proxy: {image_url[-55:]}... → {w}x{h} {tag}")
                return data.get("dataUrl")
        else:
            print(f"    proxy失败 [{r.status_code}]: {image_url[-55:]}")
    except Exception as e:
        print(f"    proxy异常: {e}")
    return None


# ────────────────────────────────────────────────────────────────
# 市场配置
# ────────────────────────────────────────────────────────────────

MARKET_LANGS = {
    # GIGA market → (市场名, 语言代码, AI 提示语言)
    "DE_TAX":     ("Amazon.de (德国)",   "DE", "德语"),
    "DE_TAXFREE": ("Amazon.de (德国免税)","DE", "德语"),
    "UK":         ("Amazon.co.uk (英国)","EN", "英语"),
    "US":         ("Amazon.com (美国)",  "EN", "英语"),
    "FR":         ("Amazon.fr (法国)",   "FR", "法语"),
}


def _get_product_use_cases(attrs: dict, category: str = "") -> list[str]:
    """从 attributes 中提取产品适用场景关键词（用于 Search Terms）。"""
    use_case = attrs.get("Use Case", "") or ""
    category = category or ""

    # 通用场景词映射
    scenario_map = {
        "garden":     ["garden", "backyard", "outdoor", "terrace", "patio", "balcony"],
        "kitchen":    ["kitchen", "cooking", "indoor", "home"],
        "office":     ["office", "workspace", "desk", "professional"],
        "bedroom":    ["bedroom", "bedding", "sleep", "home decor"],
        "bathroom":   ["bathroom", "shower", "towel", "hygiene"],
        "storage":    ["storage", "garage", "closet", "organization"],
        "furniture":  ["living room", "dining", "coffee table", "home"],
        "plant":      ["garden", "planting", "outdoor", "yard", "flower", "herb", "vegetable", "balcony"],
        "pet":        ["pet", "dog", "cat", "animal", "outdoor"],
    }

    scenarios = []
    combined = (use_case + " " + category).lower()
    for key, words in scenario_map.items():
        if any(k in combined for k in key.split()):
            scenarios.extend(words)
    return list(dict.fromkeys(scenarios))[:8]  # 去重，限8个


# ────────────────────────────────────────────────────────────────
# 提示词构造 —— 多语言市场
# ────────────────────────────────────────────────────────────────

def build_market_prompt(product: dict, market: str) -> str:
    """
    根据 GIGA 产品数据和市场构造 MiniMax M3 提示词。

    支持市场：
      DE_TAX / DE_TAXFREE → 德语文案（Amazon.de）
      UK                   → 英语文案（Amazon.co.uk）
      US                   → 英语文案（Amazon.com）
      FR                   → 法语文案（Amazon.fr）

    输出内容：
      - 产品标题（符合目标市场 SEO 规范，200字符内）
      - 五点描述（5条，每条200字符内）
      - 产品描述（完整当地语言文案，4000字符内）
      - Search Terms（符合当地消费者搜索习惯，250字节内）
    """
    cfg = MARKET_LANGS.get(market, ("Amazon (未知)", "EN", "英语"))
    market_name, lang_code, lang_name = cfg

    sku      = product.get("sku", "")
    title_raw = product.get("productName", "")
    chars    = product.get("characteristics", [])
    attrs    = product.get("attributes", {})
    material = product.get("mainMaterial", "")
    color    = attrs.get("Main Color") or product.get("mainColor") or product.get("colorMap") or ""
    style    = attrs.get("Product Style", "")
    length   = product.get("assembledLength", "")
    width    = product.get("assembledWidth", "")
    height   = product.get("assembledHeight", "")
    mpn      = product.get("mpn", "")
    category = product.get("category", "")
    manufacturer = product.get("manufacturer", "") or "YUDA HOME FURNITURE"

    chars_lines = "\n".join(f"{i+1}. {c}" for i, c in enumerate(chars[:6]))

    # 适用场景（用于 Search Terms）
    use_cases = _get_product_use_cases(attrs, category)

    # ── 市场专属 SEO 关键词基础包 ──────────────────────────────
    seo_kw = {
        "DE": {
            "category": "Pflanzenbeet, Hochbeet, Gartenbeet, Gemüsebeet",
            "material": "Metall, Stahlblech, verzinkt, rostfrei",
            "use_cases": "Garten, Terrasse, Balkon,庭院, Outdoor",
            "features": "wetterfest, langlebig, rostschutz, montage",
        },
        "EN": {
            "category": "planter, raised bed, garden bed, plant container",
            "material": "metal, steel, galvanized, rust-proof",
            "use_cases": "garden, backyard, patio, balcony, outdoor",
            "features": "weatherproof, durable, rust-resistant, easy assembly",
        },
        "FR": {
            "category": "jardiiniere, bac a fleurs, lit surleve, potager",
            "material": "metal, acier, galvanise, resistant",
            "use_cases": "jardin, terrasse, balcon, exterieur",
            "features": "resistant aux intemperies, durable, antioxidante, montage simple",
        },
    }
    kw = seo_kw.get(lang_code, seo_kw["EN"])

    # ── Search Terms 场景词（逗号分隔）───────────────────────
    use_case_str = ", ".join(use_cases) if use_cases else kw["use_cases"]

    # ── 语言专属系统角色 ──────────────────────────────────────
    roles = {
        "DE": "Amazon.de（德国站）高级 Listing 优化专家",
        "EN": "Amazon.com / Amazon.co.uk senior Listing optimization expert",
        "FR": "Expert en optimisation de Listing Amazon.fr",
    }
    role = roles.get(lang_code, roles["EN"])

    # ── 语言专属标题规范 ─────────────────────────────────────
    title_rules = {
        "DE": {
            "rules": (
                "- 包含核心关键词（Hochbeet / Pflanzenbeet / Gemüsebeet 等）\n"
                "- 包含材质关键词（Metall / Stahlblech / verzinkt）\n"
                "- 包含主要尺寸（长×宽×高 cm）\n"
                "- 包含颜色（如适用）\n"
                "- 包含品牌或制造商名\n"
                "- 禁止堆砌关键词，禁止促销语（SALE / FREE / NEW）\n"
                "- 关键词首字母大写，其余小写（标准 Amazon.de 格式）"
            ),
            "note": "德语标题示例：Hochbeet Metall 120x60x80cm, verzinktes Stahlblech Pflanzenbeet für Garten Anthrazit",
        },
        "EN": {
            "rules": (
                "- Include core keywords (raised bed / planter / garden bed / flower pot)\n"
                "- Include material keywords (galvanized steel / metal / iron)\n"
                "- Include main dimensions (L×W×H cm or inches)\n"
                "- Include color (if applicable)\n"
                "- Include brand or manufacturer name\n"
                "- Do NOT keyword stuff; do NOT use promotional words (SALE / FREE / NEW)\n"
                "- Standard title case (first letter of each word capitalized)"
            ),
            "note": "English title example: Raised Garden Bed Galvanized Steel 120x60x80cm, Weatherproof Metal Planter for Outdoor Garden Dark Gray",
        },
        "FR": {
            "rules": (
                "- Inclure les mots-cles principaux（jardiiniere / lit surleve / bac a fleurs）\n"
                "- Inclure les mots-cles materiau（acier galvanise / metal）\n"
                "- Inclure les dimensions principales（L×l×H cm）\n"
                "- Inclure la couleur（si applicable）\n"
                "- Inclure la marque ou le nom du fabricant\n"
                "- Ne pas surcharger de mots-cles, pas de mots promotionnels（SOLDES / Gratuit / Nouveau）\n"
                "- Majuscule au debut de chaque mot"
            ),
            "note": "Titre francais exemple：Jardiiniere Metal Acier Galvanise 120x60x80cm, Bac a Fleurs Resistant pour Jardin Terrasse Gris",
        },
    }
    tr = title_rules.get(lang_code, title_rules["EN"])

    # ── Search Terms 语言说明 ────────────────────────────────
    st_rules = {
        "DE": (
            "- 生成一组逗号分隔的德语搜索关键词\n"
            "- 包含产品核心词、同义词、长尾词（不超过250字节）\n"
            "- 包含当地消费者搜索习惯词（如 Hochbeet 也会搜 'Pflanzkasten' / 'Beet'）\n"
            "- 包含适用场景词（Terrasse / Balkon / Garten 等）\n"
            "- 不要重复标题中已使用的词\n"
            "- 禁止促销词（gift / free / cheap / sale / neu）\n"
            "- 格式：词1, 词2, 词3 ..."
        ),
        "EN": (
            "- Generate a comma-separated list of English search keywords\n"
            "- Include product core terms, synonyms, and long-tail keywords（max 250 bytes）\n"
            "- Include local consumer search habits（e.g. 'raised garden bed' vs 'planter box' vs 'garden bed'）\n"
            "- Include use-case terms（garden / backyard / patio / balcony / outdoor / vegetable growing）\n"
            "- Do NOT repeat words already in the title\n"
            "- Forbidden: promotional words（gift / free / cheap / sale / new）\n"
            "- Format: word1, word2, word3 ..."
        ),
        "FR": (
            "- Generer une liste de mots-cles de recherche en francais separes par des virgules\n"
            "- Inclure les termes principaux, synonymes et mots-cles a longue traine（max 250 octets）\n"
            "- Inclure les habitudes de recherche locales（ex. 'jardiiniere' vs 'bac a fleurs' vs 'pot de fleurs'）\n"
            "- Inclure les termes de scene d'utilisation（jardin / terrasse / balcon / exterieur / culture legume）\n"
            "- Ne pas repeter les mots deja dans le titre\n"
            "- Interdits：mots promotionnels（cadeau / gratuit / solde / nouveau）\n"
            "- Format：mot1, mot2, mot3 ..."
        ),
    }
    st_r = st_rules.get(lang_code, st_rules["EN"])

    title_rules_block = tr["rules"] if isinstance(tr, dict) and "rules" in tr else str(tr)

    prompt = f"""You are a {role}.
Please analyze the following GIGA B2B product data and generate a high-conversion Amazon {market_name} Listing in {lang_name}.
## Product Raw Data
- SKU: {sku}
- Original Title: {title_raw}
- Material: {material}
- Color: {color}
- Style: {style}
- Dimensions (assembled): {length} x {width} x {height} cm
- Model Number: {mpn}
- Manufacturer: {manufacturer}
- Category: {category}

## Product Characteristics（{len(chars[:6])} items, from GIGA）
{chars_lines}

## SEO Keyword Reference（use these as inspiration — do NOT copy verbatim）
Category keywords: {kw["category"]}
Material keywords: {kw["material"]}
Use-case keywords: {kw["use_cases"]}
Feature keywords: {kw["features"]}
Local consumer use-case search terms: {use_case_str}

## Output Requirements（STRICTLY follow this format, no extra explanation）

### Product Title（max 200 characters, {lang_name}）
{title_rules_block}

### Five Bullet Points（5 items, each max 200 characters, {lang_name}）
Each bullet point should:
1. Start with an uppercase letter
2. Include dimension/spec data where relevant
3. Highlight the value points most important to buyers（durability, ease of assembly, versatility）
4. Not be keyword stuffing — focus on clear benefit to the customer
5. Use blank lines to separate each bullet

### Product Description（max 4000 characters, {lang_name}）
Generate a complete product description including:
- Product overview（1-2 paragraphs）
- Main features and advantages（material, craftsmanship, protection, etc.）
- Use cases（{kw["use_cases"]} — tailor to local consumer habits）
- Usage instructions（assembly tips, soil filling recommendations, etc.）
- Brand/manufacturer information
Use HTML tags（<b>, <li>, <br>） for formatting, but do NOT keyword stuff.

### Search Terms（max 250 bytes, {lang_name}）
{st_r}
"""

    return prompt


# ────────────────────────────────────────────────────────────────
# 响应解析 —— 从 MiniMax M3 返回的 Markdown 中提取结构化字段
# ────────────────────────────────────────────────────────────────

def _section_after(text: str, *header_patterns) -> str:
    for pat in header_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if not m:
            continue
        start = m.end()
        rest = text[start:]
        stop = re.search(r"\n(?=#{1,3}\s|\n---|\n\*\*\*)", rest)
        return rest[:stop.start()] if stop else rest
    return ""


def _detect_lang(market: str) -> str:
    cfg = MARKET_LANGS.get(market, ("Amazon", "EN", "English"))
    return cfg[1]  # "DE" / "EN" / "FR"


def parse_minimax_response(raw_response: dict, market: str = "DE_TAX") -> dict:
    """
    从 MiniMax M3 响应中提取文案字段，支持 DE/EN/FR 语言。
    market 参数仅用于语言感知解析（目前通过 section 头部语言检测）。
    """
    result = {
        "title": "",
        "bullets": [],
        "description": "",
        "search_terms": "",
    }

    try:
        content = raw_response.get("data", {}).get("choices", [{}])[0].get("message", {}).get("content", "")
    except (KeyError, IndexError, TypeError):
        print(f"  [parse] 无法解析 MiniMax 响应结构: {raw_response}")
        return result

    if not content:
        print("  [parse] MiniMax 返回内容为空")
        return result

    print(f"  [parse] 原始回复长度: {len(content)} 字符")

    # ── 标题 ──────────────────────────────────────────────────
    title_section = (
        _section_after(content, r"###\s*Product\s*Title[^\n]*\n+")
        or _section_after(content, r"###\s*产品标题[（(]?Title[）)]?[^\n]*\n+")
        or _section_after(content, r"###\s*产品标题[^\n]*\n+")
        or _section_after(content, r"##\s*Product\s*Title[^\n]*\n+")
        or _section_after(content, r"##\s*产品标题[^\n]*\n+")
        or _section_after(content, r"###\s*标题[^\n]*\n+")
        or _section_after(content, r"###\s*Titre[^\n]*\n+")
    )
    if title_section:
        lines = title_section.strip().splitlines()
        for line in lines:
            cleaned = line.strip()
            if cleaned and len(cleaned) > 5 and not re.match(r"^[\[\]（）()【】<>\s]+$", cleaned):
                result["title"] = cleaned
                break

    if not result["title"]:
        m = re.search(r"(?:^|\n)(?:Title|Titre)[：:]\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
        if m:
            result["title"] = m.group(1).strip()

    # ── 五点 ──────────────────────────────────────────────────
    bullets_section = (
        _section_after(content, r"###\s*Five\s*Bullet\s*Points?[^\n]*\n+")
        or _section_after(content, r"###\s*五点描述[（(]?Bullets?[）)]?[^\n]*\n+")
        or _section_after(content, r"###\s*五点描述[^\n]*\n+")
        or _section_after(content, r"##\s*五点描述[^\n]*\n+")
        or _section_after(content, r"###\s*要点[^\n]*\n+")
        or _section_after(content, r"###\s*Points[^\n]*\n+")
        or _section_after(content, r"###\s*Bullets?[^\n]*\n+")
    )
    if bullets_section:
        parts = re.split(r"\n\s*\n", bullets_section)
        bullets = []
        for p in parts:
            cleaned = re.sub(r"^[\s\d一二三四五六七八九十.．)）\-\–•]+", "", p.strip()).strip()
            if cleaned and len(cleaned) > 10 and not re.match(r"^[\[\]（）()【】\s]+$", cleaned):
                bullets.append(cleaned)
            if len(bullets) >= 5:
                break
        if bullets:
            result["bullets"] = bullets

    # 兜底：数字编号或 bullet 符号
    if not result["bullets"]:
        matches = re.findall(
            r"(?:^|\n)(?:\d+[.．)]\s*|[-•–]\s*)([^\n]{20,300})",
            content,
            re.MULTILINE,
        )
        if matches:
            result["bullets"] = [m.strip() for m in matches[:5] if len(m.strip()) > 10]

    # ── 产品描述 ───────────────────────────────────────────────
    desc_section = (
        _section_after(content, r"###\s*Product\s*Description[^\n]*\n+")
        or _section_after(content, r"###\s*产品描述[（(]?Description[）)]?[^\n]*\n+")
        or _section_after(content, r"###\s*产品描述[^\n]*\n+")
        or _section_after(content, r"##\s*产品描述[^\n]*\n+")
        or _section_after(content, r"###\s*描述[^\n]*\n+")
        or _section_after(content, r"###\s*Description[^\n]*\n+")
    )
    if desc_section:
        lines_out = [
            line.strip() for line in desc_section.splitlines()
            if line.strip() and not re.match(r"^[\[\]（）()【】\s]+$", line.strip())
        ]
        result["description"] = "\n".join(lines_out).strip()

    # ── Search Terms ───────────────────────────────────────────
    st_section = (
        _section_after(content, r"###\s*Search\s*Terms?[^\n]*\n+")
        or _section_after(content, r"###\s*Suchbegriffe[^\n]*\n+")
        or _section_after(content, r"###\s*搜索关键词[^\n]*\n+")
        or _section_after(content, r"###\s*Mots[^\n]*\n+")
        or _section_after(content, r"##\s*Search\s*Terms?[^\n]*\n+")
        or _section_after(content, r"##\s*Suchbegriffe[^\n]*\n+")
    )
    if st_section:
        for line in st_section.splitlines():
            stripped = line.strip()
            if stripped and not re.match(r"^[\[\]（）()【】\s]+$", stripped):
                result["search_terms"] = stripped
                break

    if not result["search_terms"]:
        m = re.search(
            r"(?:Search\s*Terms|Suchbegriffe|Mots[- ]cl[éeèê]s)[：:]\s*(.+?)(?:\n|$)",
            content,
            re.IGNORECASE | re.DOTALL,
        )
        if m:
            result["search_terms"] = m.group(1).strip()[:250]

    return result


# ────────────────────────────────────────────────────────────────
# 核心 API：文案生成
# ────────────────────────────────────────────────────────────────

def generate_copy(product: dict, market: str = "DE_TAX") -> dict:
    """
    入口函数：调用 MiniMax M3 生成市场本地化的 AI 优化文案。

    参数:
        product: GIGA 产品字典
        market: 市场标识（DE_TAX / UK / US / FR）

    返回:
        {"title", "bullets", "description", "search_terms"}
    """
    if not check_server(quiet=True):
        print("  ⚠️ image-studio server 不可用，跳过 AI 文案优化")
        return {"title": "", "bullets": [], "description": "", "search_terms": ""}

    market_cfg = MARKET_LANGS.get(market, ("Amazon", "EN", "英语"))
    lang_name = market_cfg[2]

    print(f"\n  正在调用 MiniMax M3 生成{lang_name}文案（{market_cfg[0]}）...")
    prompt = build_market_prompt(product, market)

    try:
        resp = requests.post(
            f"{IMAGE_STUDIO_BASE}/api/generate-text",
            json={
                "model": "minimax",
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=120,
        )
        resp.raise_for_status()
        raw = resp.json()
    except requests.exceptions.Timeout:
        print("  ❌ MiniMax M3 请求超时（120s）")
        return {"title": "", "bullets": [], "description": "", "search_terms": ""}
    except requests.exceptions.RequestException as e:
        print(f"  ❌ MiniMax M3 请求失败: {e}")
        return {"title": "", "bullets": [], "description": "", "search_terms": ""}

    result = parse_minimax_response(raw, market)

    print(f"  ✅ 文案生成完成（{lang_name}）:")
    print(f"     标题: {result['title'][:80]}{'...' if len(result['title']) > 80 else ''}")
    print(f"     五点: {len(result['bullets'])} 条")
    print(f"     描述: {len(result['description'])} 字符")
    st_preview = (result["search_terms"] or "")[:80]
    print(f"     Search Terms: {st_preview}{'...' if len(result['search_terms'] or '') > 80 else ''}")

    return result


# ────────────────────────────────────────────────────────────────
# 核心 API：AI 图片生成
# ────────────────────────────────────────────────────────────────

def _build_image_prompt(product: dict, template: str, selling_points: list[str], description: str) -> str:
    """构造发给 laozhang/Gemini 的图片生成提示词。"""
    template_prompts = {
        "main-white": "Product on pure white background, centered, professional photography, no shadows, no reflections, high detail, commercial quality",
        "main-other": "Product in lifestyle setting, non-white background, soft natural lighting, warm atmosphere, professional e-commerce photography",
        "aplus": "Lifestyle product shot, clean and modern setting, soft natural lighting, professional e-commerce photography, detailed composition",
    }
    base_prompt = template_prompts.get(template, template_prompts["main-other"])

    attrs = product.get("attributes", {})
    title = product.get("productName", "")[:200]
    color = attrs.get("Main Color") or product.get("mainColor") or product.get("colorMap") or ""
    material = product.get("mainMaterial", "")
    length = product.get("assembledLength", "")
    width  = product.get("assembledWidth", "")
    height = product.get("assembledHeight", "")

    scene_part = "\n".join(f"- {sp}" for sp in (selling_points or [])[:3])
    tone_part  = (description or "")[:300]

    prompt = f"""You are a professional e-commerce product photographer creating a high-conversion listing image for Amazon/Walmart.

## PRODUCT IDENTITY (ABSOLUTE — NEVER VIOLATE)
- Product color, shape, surface texture, and key design features MUST remain EXACTLY as shown in the reference images.
- Do NOT introduce, remove, or alter any product attributes — color, material, structure, proportions, or details.
- The user's scene/style preferences only apply to the BACKGROUND, LIGHTING, and COMPOSITION — never to the product itself.

## PRODUCT INFO
- Product: {title}
- Color: {color}
- Material: {material}
- Dimensions: {length} x {width} x {height} cm

## SCENE DIRECTIVE
{base_prompt}

## KEY BENEFITS TO VISUALLY COMMUNICATE
{scene_part}

## VISUAL TONE REFERENCE
{tone_part}

## OUTPUT SPECIFICATION
- Aspect ratio: 1:1 (1600x1600px)
- Lighting: soft, even, natural — avoid harsh shadows or artificial studio look
- Background: clean white or minimal solid
- Quality: high detail, sharp focus, realistic materials, accurate colors
- Forbidden: watermarks, text, logos, UI elements, celebrities, brand names"""

    return prompt


def generate_image(
    product: dict,
    template: str = "main-white",
    reference_image_urls: list[str] | None = None,
    selling_points: list[str] | None = None,
    description: str = "",
) -> dict | None:
    """
    调用 laozhang/Gemini 生成一张 AI 产品图。

    参数:
        product: GIGA 产品字典
        template: "main-white" | "main-other" | "aplus"
        reference_image_urls: GIGA 图片 URL 列表
        selling_points: 要在图中传达的卖点列表
        description: 产品描述（作为视觉调性参考）

    返回:
        {"dataUrl": "data:image/...;base64,...", "width": int, "height": int}
        失败返回 None。
    """
    if not check_server(quiet=True):
        print("  ⚠️ image-studio server 不可用，跳过 AI 图片生成")
        return None

    print(f"\n  正在调用 laozhang/Gemini 生成图片 (template={template})...")

    ref_b64 = []
    if reference_image_urls:
        for url in reference_image_urls[:4]:
            data_url = proxy_image_to_base64(url)
            if data_url:
                ref_b64.append(data_url)

    prompt = _build_image_prompt(product, template, selling_points or [], description)

    try:
        resp = requests.post(
            f"{IMAGE_STUDIO_BASE}/api/generate-image",
            json={
                "prompt": prompt,
                "referenceImages": ref_b64,
                "size": "1600x1600",
                "imageSize": "1024x1024",
            },
            timeout=120,
        )
        resp.raise_for_status()
        raw = resp.json()
    except requests.exceptions.Timeout:
        print("  ❌ laozhang 图片生成超时（120s）")
        return None
    except requests.exceptions.RequestException as e:
        print(f"  ❌ laozhang 图片生成失败: {e}")
        return None

    try:
        images_data = raw.get("data", {}).get("images", [])
        if not images_data:
            images_data = (
                raw.get("data", {})
                .get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            if isinstance(images_data, str):
                images_data = [{"base64": images_data}]

        if images_data and isinstance(images_data[0], dict):
            b64 = images_data[0].get("base64", "")
            if b64:
                data_url = f"data:image/jpeg;base64,{b64}"
                print(f"  ✅ 图片生成成功")
                return {"dataUrl": data_url, "width": 1600, "height": 1600}
    except (KeyError, IndexError, TypeError) as e:
        print(f"  [parse] 无法解析 laozhang 图片响应: {e}")

    return None


# ────────────────────────────────────────────────────────────────
# 批量文案生成
# ────────────────────────────────────────────────────────────────

def generate_batch_copy(products: list[dict], market: str = "DE_TAX") -> list[dict]:
    """对多个产品批量调用文案生成。"""
    results = []
    for i, p in enumerate(products, 1):
        sku = p.get("sku", f"产品{i}")
        print(f"\n{'='*60}")
        print(f"  [{i}/{len(products)}] 处理 SKU: {sku}")
        print(f"{'='*60}")
        result = generate_copy(p, market)
        result["sku"] = sku
        results.append(result)
    return results
