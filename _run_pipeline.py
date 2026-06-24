"""
GIGAB2B → AI 优化 → Amazon 模板
一键执行入口，支持多市场、多语言、自动启动 image-studio server。

用法（交互模式）:
  python _run_pipeline.py

用法（命令行模式）:
  python _run_pipeline.py --sku W3372P314940 --market DE_TAX
  python _run_pipeline.py --sku SKU1,SKU2 --market UK --image-strategy use_giga
  python _run_pipeline.py --no-ai
"""

import sys
import os
import argparse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GIGAB2B_ROOT = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(GIGAB2B_ROOT, ".env")

# ────────────────────────────────────────────────────────────────
# 前置检查
# ────────────────────────────────────────────────────────────────
if not os.path.exists(ENV_FILE):
    print("=" * 60)
    print("  ERROR: .env 文件不存在")
    print(f"  路径: {ENV_FILE}")
    print("  请复制 .env.example 为 .env 并填入 GIGA 凭证")
    print("=" * 60)
    sys.exit(1)

# ────────────────────────────────────────────────────────────────
# CLI 参数解析
# ────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="GIGAB2B → AI 优化文案 → 填入 Amazon 模板",
    formatter_class=argparse.RawDescriptionHelpFormatter,
    epilog="""
市场与语言对应：
  DE_TAX     → Amazon.de 德语（德国）
  DE_TAXFREE → Amazon.de 德语（德国免税）
  UK         → Amazon.co.uk 英语（英国）
  US         → Amazon.com 英语（美国）
  FR         → Amazon.fr 法语（法国）

图片策略：
  ask            → 交互选择（默认）
  use_giga       → 直接使用 GIGA 原图
  generate_main  → AI 生成主图（替换主图）
  generate_aplus → AI 生成 A+ 图（副图）
  generate_all   → AI 生成所有图片

示例：
  python _run_pipeline.py --sku W3372P314940 --market DE_TAX
  python _run_pipeline.py --sku W3372P314940 --market UK --image-strategy use_giga
  python _run_pipeline.py --sku W3372P314940 --market FR --no-ai
    """,
)
parser.add_argument("--sku",      help="GIGA 产品 SKU（多个用逗号分隔）")
parser.add_argument("--market",   choices=["DE_TAX","DE_TAXFREE","UK","US","FR"],
                    help="目标市场（影响语言和 GIGA API 凭证）")
parser.add_argument("--image-strategy",
                    choices=["ask","use_giga","generate_main","generate_aplus","generate_all"],
                    default="ask",
                    help="图片处理策略（默认 ask：交互选择）")
parser.add_argument("--no-ai",   action="store_true", help="跳过 AI 优化")
parser.add_argument("--output-dir", default=GIGAB2B_ROOT, help="输出目录")
args = parser.parse_args()

# ────────────────────────────────────────────────────────────────
# 交互式选择
# ────────────────────────────────────────────────────────────────

MARKET_OPTIONS = [
    ("DE_TAX",     "Amazon.de (德国·含税)   → 德语"),
    ("DE_TAXFREE", "Amazon.de (德国·免税)   → 德语"),
    ("UK",         "Amazon.co.uk (英国)      → 英语"),
    ("US",         "Amazon.com (美国)        → 英语"),
    ("FR",         "Amazon.fr (法国)         → 法语"),
]

MARKET_LANG = {
    "DE_TAX": "德语", "DE_TAXFREE": "德语",
    "UK": "英语", "US": "英语", "FR": "法语",
}

IMAGE_STRATEGIES = [
    ("use_giga",      "① 使用 GIGA 原图（不改图，快速）"),
    ("generate_main", "② AI 生成主图（替换主图为白底商品图）"),
    ("generate_aplus","③ AI 生成 A+ 图（生成生活场景图）"),
    ("generate_all",  "④ AI 生成全部图片（主图+副图+A+图）"),
]


def ask_market() -> str:
    """交互选择市场。"""
    print("\n  请选择目标市场：")
    for i, (key, label) in enumerate(MARKET_OPTIONS, 1):
        print(f"    {i}. {label}")
    print(f"    0. 退出")
    while True:
        try:
            choice = input("\n  请输入编号 [1-5]: ").strip()
            if choice == "0":
                sys.exit(0)
            idx = int(choice) - 1
            if 0 <= idx < len(MARKET_OPTIONS):
                return MARKET_OPTIONS[idx][0]
        except (ValueError, EOFError, KeyboardInterrupt):
            pass
        print("  无效选择，请重新输入。")


def ask_image_strategy() -> str:
    """交互选择图片策略。"""
    print("\n  请选择图片策略：")
    for _, label in IMAGE_STRATEGIES:
        print(f"    {label}")
    print(f"    0. 退出")
    while True:
        try:
            choice = input("\n  请输入编号 [0-4]: ").strip()
            if choice == "0":
                sys.exit(0)
            idx = int(choice) - 1
            if 1 <= idx <= len(IMAGE_STRATEGIES):
                return IMAGE_STRATEGIES[idx - 1][0]
        except (ValueError, EOFError, KeyboardInterrupt):
            pass
        print("  无效选择，请重新输入。")


def ask_sku() -> str | None:
    """交互输入 SKU。"""
    print("\n  请输入 GIGA 产品 SKU（多个用逗号分隔）：")
    try:
        sku = input("  SKU: ").strip()
        if sku:
            return sku
    except (EOFError, KeyboardInterrupt):
        pass
    return None


def ask_server_start() -> bool:
    """询问是否启动 image-studio server。"""
    print("\n  image-studio server 未运行。")
    try:
        choice = input("  是否自动启动？ [Y/n]: ").strip().lower()
        return choice in ("", "y", "yes")
    except (EOFError, KeyboardInterrupt):
        return False


# ────────────────────────────────────────────────────────────────
# 确定参数（命令行优先，交互其次）
# ────────────────────────────────────────────────────────────────
market = args.market
if not market:
    market = ask_market()

sku_input = args.sku
if not sku_input:
    sku_input = ask_sku()
    if not sku_input:
        print("  错误: 未提供 SKU")
        sys.exit(1)

skus = [s.strip() for s in sku_input.split(",") if s.strip()]

image_strategy = args.image_strategy
if image_strategy == "ask":
    image_strategy = ask_image_strategy()

no_ai = args.no_ai

# ────────────────────────────────────────────────────────────────
# 导入核心模块
# ────────────────────────────────────────────────────────────────
from _fill_template import fetch_giga_product, fill_template, TEMPLATE_PATH
from giga_config import MARKET_CONFIG
import _ai_optimizer as ao

market_name = MARKET_CONFIG.get(market, {}).get("name", market)
lang = MARKET_LANG.get(market, "英语")

print()
print("=" * 60)
print("  GIGAB2B → AI 优化 → Amazon 模板")
print("=" * 60)
print(f"  市场:       {market_name} ({market}) | 语言: {lang}")
print(f"  SKU 数量:  {len(skus)} 个")
print(f"  图片策略:  {image_strategy}")
print(f"  AI 优化:  {'启用' if not no_ai else '跳过（--no-ai）'}")
print(f"  模板路径:  {TEMPLATE_PATH}")
print("=" * 60)

# ────────────────────────────────────────────────────────────────
# Server 管理
# ────────────────────────────────────────────────────────────────
server_started_by_us = False

if not no_ai:
    if not ao.check_server(quiet=True):
        if ask_server_start():
            if ao.start_server(block=True, timeout=30):
                server_started_by_us = True
            else:
                print("\n  ⚠️  server 启动失败，将跳过 AI 优化")
                no_ai = True
        else:
            print("\n  ⚠️  用户取消，将跳过 AI 优化")
            no_ai = True
    else:
        print("\n  ✅ image-studio server 已就绪")

# ────────────────────────────────────────────────────────────────
# 主循环
# ────────────────────────────────────────────────────────────────
results = []
errors  = []

for i, sku in enumerate(skus, 1):
    print(f"\n{'─'*60}")
    print(f"  [{i}/{len(skus)}] 处理 SKU: {sku}")
    print(f"{'─'*60}")

    out_name = f"{sku}-{market}.xlsm"
    out_path = os.path.join(args.output_dir, out_name)

    try:
        # Step 1: GIGA 取数
        print(f"\n  [1/4] GIGA API ({market_name})...")
        product = fetch_giga_product(sku, market)
        pname = (product.get("productName") or "")[:70]
        print(f"       {pname}...")

        # Step 2: AI 文案优化
        if no_ai:
            print(f"\n  [2/4] 跳过 AI 优化（--no-ai）")
            ai_result = {
                "title": product.get("productName", ""),
                "bullets": product.get("characteristics", [])[:5],
                "description": "",
                "search_terms": "",
            }
        else:
            print(f"\n  [2/4] AI 文案优化（MiniMax M3 · {lang}）...")
            ai_result = ao.generate_copy(product, market=market)
            if ai_result.get("title"):
                print(f"       标题: {ai_result['title'][:70]}...")
            else:
                print("       ⚠️  AI 未返回标题")

        # Step 3: 图片处理
        print(f"\n  [3/4] 图片处理（策略: {image_strategy}）")
        giga_images = product.get("imageUrls") or []
        print(f"       GIGA 图片: {len(giga_images)} 张")

        generated_images = []   # AI 生成的图片（dataUrl 列表）

        if not no_ai and image_strategy != "use_giga":
            # 加载 AI 图片
            print(f"       正在生成 AI 图片...")

            # 确定要生成哪些类型的图
            templates_to_generate = []
            if image_strategy in ("generate_main", "generate_all"):
                templates_to_generate.append("main-white")
            if image_strategy in ("generate_aplus", "generate_all"):
                templates_to_generate += ["main-other", "aplus"]

            sp = ai_result.get("bullets", []) or []
            desc = ai_result.get("description", "")

            for tpl in templates_to_generate:
                img_result = ao.generate_image(
                    product,
                    template=tpl,
                    reference_image_urls=giga_images[:2],
                    selling_points=sp,
                    description=desc,
                )
                if img_result and img_result.get("dataUrl"):
                    generated_images.append(img_result)

            print(f"       AI 生成图片: {len(generated_images)} 张")

            if generated_images:
                # generated_images 的 dataUrl 是 base64，目前无法直接填入 URL 列。
                # 模板中保留 GIGA 原图 URL，AI 图片请用户在 image-studio 中下载后上传到 Seller Central。
                print(f"       提示: AI 生成图片请在 image-studio 中手动下载并上传到 Amazon Seller Central")
        else:
            print(f"       直接使用 GIGA 原图")

        # Step 4: 填入模板
        print(f"\n  [4/4] 写入 Excel...")
        fill_template(
            product,
            ai_result,
            row=7,
            out_path=out_path,
            image_strategy=image_strategy,
            market=market,
        )
        print(f"       保存为: {out_path}")

        results.append({
            "sku": sku,
            "out": out_path,
            "ai_title": (ai_result.get("title") or "")[:60],
            "ai_bullets": len(ai_result.get("bullets") or []),
            "giga_images": len(giga_images),
            "generated_images": len(generated_images),
        })

    except Exception as e:
        import traceback
        print(f"\n  ❌ 失败: {e}")
        traceback.print_exc()
        errors.append({"sku": sku, "error": str(e)})

# ────────────────────────────────────────────────────────────────
# 汇总
# ────────────────────────────────────────────────────────────────
print()
print("=" * 60)
print(f"  处理完成: 成功 {len(results)} 个" + (f", 失败 {len(errors)} 个" if errors else ""))
print("=" * 60)

if results:
    print()
    for r in results:
        print(f"  [OK]  {r['sku']}")
        print(f"        {r['out']}")
        if r.get("ai_title"):
            print(f"        AI标题: {r['ai_title']}...")

if errors:
    print()
    print("  失败列表:")
    for e in errors:
        print(f"  [FAIL] {e['sku']}: {e['error']}")

# 清理我们启动的 server
if server_started_by_us:
    print("\n  正在停止 image-studio server...")
    ao.stop_server()
    print("  ✅ server 已停止")
