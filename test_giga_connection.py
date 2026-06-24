"""
GIGA Open API 2.0 - 多市场连接测试脚本

使用方法:
  # 复制模板（首次）: copy .env.example .env
  # 填入凭证后，直接运行:

  python test_giga_connection.py --market US
  python test_giga_connection.py --market DE_TAX
  python test_giga_connection.py --market DE_TAXFREE
  python test_giga_connection.py --market UK

  # 指定 SKU:
  python test_giga_connection.py --market US W10172S00004 SKU2...
  python test_giga_connection.py --market DE_TAX W3372P314940
"""

import os
import sys

# 强制 UTF-8 输出（Windows PowerShell 中文乱码问题）
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import json
import time
import random
import string
import base64
import hmac
import hashlib
import requests
import argparse

from giga_config import MARKET_CONFIG, DEFAULT_MARKET, get_credentials, BASE_URL

GIGA_ENV = os.getenv("GIGA_ENV", "production").lower()


def generate_nonce(length: int = 10) -> str:
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))


def hmac_sha256_hex(message: str, key: str) -> str:
    return hmac.new(
        key.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


def build_sign(client_id: str, client_secret: str,
               timestamp: int, nonce: str, uri: str) -> str:
    msg = f"{client_id}&{uri}&{timestamp}&{nonce}"
    key = f"{client_id}&{client_secret}&{nonce}"
    hex_digest = hmac_sha256_hex(msg, key)
    return base64.b64encode(hex_digest.encode("utf-8")).decode("utf-8")


def make_headers(client_id: str, client_secret: str, uri: str) -> dict:
    timestamp_ms = int(time.time() * 1000)
    nonce = generate_nonce(10)
    sign = build_sign(client_id, client_secret, timestamp_ms, nonce, uri)
    return {
        "Content-Type": "application/json",
        "client-id": client_id,
        "timestamp": str(timestamp_ms),
        "nonce": nonce,
        "sign": sign,
    }


def post(client_id: str, client_secret: str, uri: str,
         payload: dict, description: str = "") -> dict:
    url = f"{BASE_URL}{uri}"
    headers = make_headers(client_id, client_secret, uri)

    print(f"\n{'='*60}")
    print(f"接口: {description or uri}")
    print(f"URL:  {url}")
    print(f"请求头 client-id: {headers['client-id']}")
    print(f"请求头 timestamp: {headers['timestamp']}")
    print(f"请求头 nonce:     {headers['nonce']}")
    print(f"请求体: {payload}")
    print("-" * 60)

    response = requests.post(url, json=payload, headers=headers, timeout=30)
    print(f"HTTP 状态码: {response.status_code}")

    try:
        result = response.json()
    except ValueError:
        print(f"响应 (非 JSON): {response.text}")
        return {}

    if "product/detailInfo" in uri:
        summarize_product_detail(result, payload.get("skus", []))
    elif "inventory/quantity" in uri:
        summarize_inventory(result, payload.get("skus", []))
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))

    return result


def is_empty_product(item: dict) -> bool:
    return all(item.get(k) in (None, "", []) for k in ["productName", "imageUrls", "weight", "category"])


def summarize_product_detail(result: dict, requested_skus: list):
    success = result.get("success")
    code    = result.get("code")
    msg     = result.get("msg")
    sub_msg = result.get("subMsg")
    items   = result.get("data") or []

    print(f"业务状态: success={success}  code={code}  msg={msg}")
    if sub_msg:
        print(f"         subMsg={sub_msg}")

    if not success or not items:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    returned_skus = {it.get("sku") for it in items}
    missing = [s for s in requested_skus if s not in returned_skus]
    empty   = [it["sku"] for it in items if is_empty_product(it)]
    ok      = [it["sku"] for it in items if not is_empty_product(it)]

    print(f"请求 {len(requested_skus)} 个 SKU, 返回 {len(items)} 条记录")
    if ok:      print(f"  有数据:  {ok}")
    if empty:    print(f"  全空:    {empty}")
    if missing: print(f"  未返回:  {missing}")

    if ok:
        sample = next(it for it in items if it["sku"] in ok)
        print(f"\n示例产品 [{sample['sku']}]:")
        print(f"  名称: {sample.get('productName')}")
        print(f"  MPN:  {sample.get('mpn')}")
        print(f"  类目: {sample.get('category')}")
        print(f"  尺寸: {sample.get('length')} x {sample.get('width')} x {sample.get('height')} {sample.get('lengthUnit')}")
        print(f"  重量: {sample.get('weight')} {sample.get('weightUnit')}")
        print(f"  主图: {sample.get('mainImageUrl')}")
        if sample.get("imageUrls"):
            print(f"  图片数: {len(sample['imageUrls'])}")
        if sample.get("brandInfo"):
            print(f"  品牌: {sample['brandInfo'].get('brandName')}")

        extras = []
        for key, label, trunc in [
            ("description",      "描述",      120),
            ("upc",              "UPC",       0),
            ("placeOfOrigin",    "产地",      0),
            ("mainMaterial",     "主材",      0),
            ("mainColor",        "主色",      0),
            ("characteristics",  "特性",      0),
            ("attributes",       "属性",      0),
            ("customList",       "自定义",    0),
            ("certificationList","认证",      0),
            ("firstArrivalDate", "首次到货",  0),
        ]:
            val = sample.get(key)
            if not val:
                continue
            v = str(val)
            if trunc and len(v) > trunc:
                v = v[:trunc] + "..."
            extras.append((label, v if label != "特性" else f"{len(val)} 条"))
        if sample.get("sellerInfo"):
            extras.append(("卖家", sample["sellerInfo"].get("sellerName") or sample["sellerInfo"].get("name") or "有"))
        if sample.get("comboFlag"):
            extras.append(("组合", "是"))

        if extras:
            print("\n扩展字段:")
            for k, v in extras:
                print(f"  {k}: {v}")

        all_fields = [f for f in sample if f != "sku" and not f.endswith("Unit")]
        filled = [f for f in all_fields if sample.get(f) not in (None, "", [], {})]
        rate = len(filled) / len(all_fields) * 100 if all_fields else 0
        print(f"\n数据填充率: {len(filled)}/{len(all_fields)} ({rate:.0f}%)")


def summarize_inventory(result: dict, requested_skus: list):
    success = result.get("success")
    code    = result.get("code")
    msg     = result.get("msg")
    sub_msg = result.get("subMsg")
    items   = result.get("data") or []

    print(f"业务状态: success={success}  code={code}  msg={msg}")
    if sub_msg:
        print(f"         subMsg={sub_msg}")

    if not success:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    print(f"\n请求 {len(requested_skus)} 个 SKU, 返回 {len(items)} 条记录\n")

    for it in items:
        sku     = it.get("sku")
        buyer   = it.get("buyerInventoryInfo")   or {}
        seller  = it.get("sellerInventoryInfo")   or {}
        next_arr= seller.get("nextArrivalInventory") or {}

        print(f"【{sku}】")
        print(f"  买家可用库存: {buyer.get('totalBuyerAvailableInventory')}  件")
        if buyer.get('totalSystemLockedInventory') or buyer.get('totalBuyerLockedInventory'):
            print(f"  买家锁定(系统): {buyer.get('totalSystemLockedInventory')}  件")
            print(f"  买家锁定(自身): {buyer.get('totalBuyerLockedInventory')}  件")

        total_fee = buyer.get("totalStorageFee")
        unpaid_fee= buyer.get("unpaidStorageFee")
        currency  = buyer.get("currency") or "USD"
        if total_fee is not None and total_fee > 0:
            print(f"  仓储费: {total_fee} {currency}  (未结: {unpaid_fee} {currency})")

        print(f"  卖家可用库存: {seller.get('sellerAvailableInventory')}  件  (折扣库存: {seller.get('discountAvailableInventory')})")

        if next_arr:
            nb = next_arr.get("nextArrivalBegin")
            ne = next_arr.get("nextArrivalEnd")
            nq_min = next_arr.get("nextArrivalQtyMin")
            nq_max = next_arr.get("nextArrivalQtyMax")
            print(f"  下批到货: {nb} ~ {ne}  数量: {nq_min}-{nq_max} 件")
        print()


# ──────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────
DEFAULT_TEST_SKUS = ["W3372P314940"]


def main():
    parser = argparse.ArgumentParser(description="GIGA B2B 多市场 API 测试")
    parser.add_argument("--market", "-m",
                        default=DEFAULT_MARKET,
                        choices=list(MARKET_CONFIG.keys()),
                        help="目标市场 (默认: %(default)s)")
    parser.add_argument("skus", nargs="*", default=DEFAULT_TEST_SKUS,
                        help="要查询的 SKU")
    args = parser.parse_args()

    client_id, client_secret = get_credentials(args.market)
    market_info = MARKET_CONFIG.get(args.market, {})
    market_name = market_info.get("name", args.market)
    skus = args.skus if args.skus else DEFAULT_TEST_SKUS

    print("=" * 60)
    print("GIGA Open API 2.0 - 多市场连接测试")
    print("=" * 60)
    print(f"市场:      {market_name} ({args.market})")
    print(f"Client ID: {client_id[:4]}...{client_id[-4:]}")
    print(f"环境:      {GIGA_ENV}")
    print(f"Base URL:  {BASE_URL}")

    try:
        post(client_id, client_secret,
             "/b2b-overseas-api/v1/buyer/product/detailInfo/v1",
             {"skus": skus},
             f"产品详情查询 ({len(skus)} 个)")
        post(client_id, client_secret,
             "/b2b-overseas-api/v1/buyer/inventory/quantity/v2",
             {"skus": skus},
             f"库存查询 ({len(skus)} 个)")
        print("\n测试完成。")
    except Exception as e:
        print(f"\n请求异常: {e}")


if __name__ == "__main__":
    main()
