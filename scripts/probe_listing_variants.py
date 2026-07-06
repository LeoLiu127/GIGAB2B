"""
Probe GIGA detailInfo/v1 response shape — verify whether
`associateProductList` actually contains sibling SKUs of the same
listing (different color/size variants).

This is a read-only diagnostic. It does NOT modify any business code.

Usage:
    python scripts/probe_listing_variants.py --market DE_TAX W3372P314940
    python scripts/probe_listing_variants.py --market DE_TAX W3372P314940 W2339P502190 W2678P312247
    python scripts/probe_listing_variants.py                   # uses defaults below

The script:
  1. Reuses giga_config.BASE_URL + get_credentials() for HMAC signing.
  2. Calls POST /b2b-overseas-api/v1/buyer/product/detailInfo/v1 with body {"skus": [...]}.
  3. For each item in response.data, prints summary + dumps full JSON to
     outputs/_probe/<timestamp>_<sku>.json for manual review.
  4. Prints a verdict per SKU:
       ✓ associateProductList non-empty → "has N variants"
       ✗ associateProductList empty     → "no sibling SKUs, fallback to single-SKU"

Decisions:
  - Run BEFORE writing any listing-aware code.
  - If associateProductList is populated with sibling SKUs (different colors/sizes),
    proceed with Option A (giga_fetch_listing using associateProductList / comboInfo).
  - If empty, the implementation still works but variants[] will be empty for old products.
"""

import argparse
import base64
import hashlib
import hmac
import io
import json
import os
import random
import string
import sys
import time
from pathlib import Path

# Windows console: 强制 UTF-8 防止中文 print 报错
if sys.platform == "win32":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")
    except Exception:
        pass

# ──────────────────────────────────────────────
# 让脚本可独立运行：复用 giga_config 的 BASE_URL / 凭证加载
# ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from giga_config import BASE_URL, get_credentials  # noqa: E402

# ──────────────────────────────────────────────
# 签名（与 app.py:_sign 完全一致）
# ──────────────────────────────────────────────
URI = "/b2b-overseas-api/v1/buyer/product/detailInfo/v1"


def _nonce(l=10):
    return "".join(random.choices(string.ascii_letters + string.digits, k=l))


def _sign(client_id, client_secret, ts_ms, nonce):
    msg = f"{client_id}&{URI}&{ts_ms}&{nonce}"
    key = f"{client_id}&{client_secret}&{nonce}"
    hex_digest = hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return base64.b64encode(hex_digest.encode()).decode()


def giga_post(skus, market):
    """调一次 GIGA detailInfo/v1，返回完整 JSON dict（不取 items[0]）。"""
    import requests  # 本地 import，避免脚本被 import 时强制 requests 依赖

    cid, sec = get_credentials(market)
    ts = int(time.time() * 1000)
    nonce_val = _nonce()
    sign = _sign(cid, sec, ts, nonce_val)

    resp = requests.post(
        f"{BASE_URL}{URI}",
        json={"skus": list(skus)},
        headers={
            "Content-Type": "application/json",
            "client-id": cid,
            "timestamp": str(ts),
            "nonce": nonce_val,
            "sign": sign,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"GIGA HTTP {resp.status_code}: {resp.text[:300]}"
        )
    try:
        return resp.json()
    except ValueError:
        raise RuntimeError(f"GIGA 返回非 JSON: {resp.text[:300]}")


# ──────────────────────────────────────────────
# 摘要打印
# ──────────────────────────────────────────────
def _print_item_summary(idx, item):
    sku = item.get("sku", "<无 sku 字段>")
    name = item.get("productName", "")
    main_color = item.get("mainColor", "")
    main_material = item.get("mainMaterial", "")
    texture = item.get("texture", "")
    attributes = item.get("attributes") or {}
    assoc = item.get("associateProductList") or []
    combo_flag = item.get("comboFlag", False)
    combo_info = item.get("comboInfo") or []

    print(f"\n  ── Item #{idx}: {sku}")
    print(f"     productName : {name}")
    print(f"     mainColor   : {main_color}")
    print(f"     mainMaterial: {main_material}")
    print(f"     texture     : {texture}")
    print(f"     comboFlag   : {combo_flag}    comboInfo 长度: {len(combo_info) if isinstance(combo_info, list) else 'N/A'}")
    print(f"     attributes  ({len(attributes)} keys):")
    for k, v in list(attributes.items())[:20]:
        print(f"        · {k} = {v}")
    if len(attributes) > 20:
        print(f"        · ...(其余 {len(attributes) - 20} 个省略)")
    print(f"     associateProductList 长度: {len(assoc) if isinstance(assoc, list) else 'N/A'}")
    if isinstance(assoc, list) and assoc:
        print(f"        前 10 项: {assoc[:10]}")
    if isinstance(combo_info, list) and combo_info:
        print(f"     comboInfo 首项: {combo_info[0]}")


def probe_one(sku, market, probe_dir):
    print(f"\n{'=' * 70}")
    print(f"[probe] SKU={sku}  market={market}")
    print(f"{'=' * 70}")
    try:
        resp = giga_post([sku], market)
    except Exception as e:
        print(f"  ✗ GIGA 调用失败: {e}")
        return False

    # 落盘完整响应
    ts_str = time.strftime("%Y%m%d-%H%M%S")
    out_path = probe_dir / f"{ts_str}_{sku}.json"
    out_path.write_text(json.dumps(resp, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  · 完整响应已写到 {out_path}")

    # 顶层 code / message
    code = resp.get("code")
    msg = resp.get("message", "")
    print(f"  · 顶层 code={code}  message={msg}")

    items = resp.get("data") or []
    if not isinstance(items, list) or not items:
        print(f"  ✗ data 为空或不是列表 — SKU 在 GIGA 中查不到（可能未加收藏夹 / 无库存）")
        return False

    print(f"  · 返回 {len(items)} 个 item：")
    for i, it in enumerate(items):
        _print_item_summary(i, it)

    # 决策门
    main = items[0]
    assoc = main.get("associateProductList") or []
    combo_flag = main.get("comboFlag", False)
    combo_info = main.get("comboInfo") or []

    if isinstance(assoc, list) and assoc:
        print(f"\n  ✓ associateProductList 有 {len(assoc)} 项 — 可作为 listing 变体源")
        print(f"     这些 SKU 是同 listing 的兄弟（颜色/尺寸变体）很可能成立")
        return True
    if combo_flag and isinstance(combo_info, list) and combo_info:
        print(f"\n  ◐ associateProductList 为空，但 comboFlag=True 且 comboInfo 有 {len(combo_info)} 项")
        print(f"     可以用 comboInfo 作为变体源（语义是组合子品，与颜色/尺寸略不同）")
        return True
    print(f"\n  ✗ associateProductList 为空 + comboInfo 为空 — 该 SKU 没有 listing 兄弟")
    print(f"     此 SKU 走单 SKU 路径即可，VariantsList 不渲染")
    return False


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Probe GIGA listing variant fields")
    parser.add_argument("skus", nargs="*", help="GIGA SKU 列表（空格分隔）")
    parser.add_argument(
        "--market",
        default=os.getenv("GIGA_PROBE_MARKET", "DE_TAX"),
        help="市场代码（默认 DE_TAX，可用 US/UK/FR/DE_TAXFREE）",
    )
    args = parser.parse_args()

    skus = args.skus or ["W3372P314940", "W2339P502190", "W2678P312247"]
    probe_dir = ROOT / "outputs" / "_probe"
    probe_dir.mkdir(parents=True, exist_ok=True)

    print(f"[probe] GIGA base URL = {BASE_URL}")
    print(f"[probe] 市场 = {args.market}")
    print(f"[probe] 待探测 SKU: {skus}")
    print(f"[probe] 输出目录: {probe_dir}")

    results = {}
    for sku in skus:
        results[sku] = probe_one(sku, args.market, probe_dir)

    print(f"\n{'=' * 70}")
    print("[probe] 总览：")
    for sku, ok in results.items():
        mark = "✓" if ok else "✗"
        print(f"   {mark} {sku}")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()