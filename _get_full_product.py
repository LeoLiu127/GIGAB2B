"""
获取 GIGA 产品完整数据（JSON 输出），用于填入 Excel 模板
"""
import sys
import os
import json
import time
import random
import string
import base64
import hmac
import hashlib
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GIGA_ENV = os.getenv("GIGA_ENV", "production").lower()
BASE_URL = "https://openapi.gigab2b.com"

from giga_config import MARKET_CONFIG, get_credentials

def generate_nonce(length=10):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def hmac_sha256_hex(message, key):
    return hmac.new(key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()

def build_sign(client_id, client_secret, timestamp_ms, nonce, uri):
    msg = f"{client_id}&{uri}&{timestamp_ms}&{nonce}"
    key = f"{client_id}&{client_secret}&{nonce}"
    hex_digest = hmac_sha256_hex(msg, key)
    return base64.b64encode(hex_digest.encode("utf-8")).decode("utf-8")

def make_headers(client_id, client_secret, uri):
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

def post(client_id, client_secret, uri, payload):
    url = f"{BASE_URL}{uri}"
    headers = make_headers(client_id, client_secret, uri)
    response = requests.post(url, json=payload, headers=headers, timeout=30)
    return response.json()

SKU = "W3372P314940"
MARKET = "DE_TAX"

client_id, client_secret = get_credentials(MARKET)
result = post(client_id, client_secret,
              "/b2b-overseas-api/v1/buyer/product/detailInfo/v1",
              {"skus": [SKU]})

items = result.get("data") or []
for it in items:
    # 只打印完整 JSON，不截断
    print(json.dumps(it, indent=2, ensure_ascii=False))
