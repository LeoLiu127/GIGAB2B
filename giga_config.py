"""
GIGA B2B 多市场配置

凭证加载顺序（优先级从高到低）:
  1. 同目录 .env 文件中的变量
  2. 环境变量（系统级）
"""

import os
from pathlib import Path

# ──────────────────────────────────────────────
# .env 加载
# ──────────────────────────────────────────────
ENV_FILE = Path(__file__).parent / ".env"


def _load_env():
    """将 .env 文件中的变量注入 os.environ（如果存在）"""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # 不覆盖已存在的系统环境变量
        if key and value and key not in os.environ:
            os.environ[key] = value


_load_env()

# ──────────────────────────────────────────────
# 市场配置表（仅包含元数据，凭证从 .env / 环境变量读取）
# ──────────────────────────────────────────────
# 已知差异：本表只含 4 个市场（缺 FR），而 app.py:MARKET_KEYS 含 5 个（含 FR）。
# 这两份表有意保持独立——giga_config 用于 scripts/probe_listing_variants.py 与
# test_giga_connection.py（外部脚本，不依赖 Flask），app.MARKET_KEYS 用于 HTTP 路由。
# 模板适配相关配置请读 templates_catalog.py，不要在这里加。
_MARKET_KEYS = {
    "US":        ("GIGA_US_CLIENT_ID",        "GIGA_US_CLIENT_SECRET"),
    "DE_TAX":    ("GIGA_DE_TAX_CLIENT_ID",    "GIGA_DE_TAX_CLIENT_SECRET"),
    "DE_TAXFREE":("GIGA_DE_TAXFREE_CLIENT_ID","GIGA_DE_TAXFREE_CLIENT_SECRET"),
    "UK":        ("GIGA_UK_CLIENT_ID",        "GIGA_UK_CLIENT_SECRET"),
}

MARKET_CONFIG = {
    market: {"name": _NAMES.get(market, market)}
    for market, _NAMES in (
        ("US",        {"name": "美国"}),
        ("DE_TAX",    {"name": "德国(含税)"}),
        ("DE_TAXFREE",{"name": "德国(免税)"}),
        ("UK",        {"name": "英国"}),
    )
}


def get_credentials(market: str) -> tuple[str, str]:
    """返回 (client_id, client_secret)"""
    keys = _MARKET_KEYS.get(market)
    if not keys:
        raise ValueError(f"未知市场: {market}，可用: {list(_MARKET_KEYS.keys())}")

    cid_key, sec_key = keys
    cid = os.environ.get(cid_key, "").strip()
    sec = os.environ.get(sec_key, "").strip()

    if not cid or not sec:
        raise RuntimeError(
            f"[{market}] 凭证未配置。"
            f"请在 .env 文件中设置 {cid_key} 和 {sec_key}，"
            f"或者复制 .env.example 为 .env 后填入。"
        )

    return cid, sec


# 默认市场（不带 --market 参数时使用）
DEFAULT_MARKET = "US"

# Base URL（多市场共用，签名逻辑一致）
BASE_URL = "https://openapi-sandbox.gigab2b.com" if os.getenv("GIGA_ENV") == "sandbox" else "https://openapi.gigab2b.com"
