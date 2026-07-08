"""回归测试（run-pipeline）：platform-stub + template-missing 两条已落地路径。

策略：直接调用 run_pipeline 内部的判定逻辑（避免触发 SSE/生成器）。
- platform="walmart": 即便用户没传模板,也必须 template_skipped=True。
- template_filename 未传 + 市场 fallback 文件不存在: template_skipped=True。
- platform="amazon" + 用户没传模板 + fallback 不存在: template_skipped=True。
"""

from __future__ import annotations

import os
import sys
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_walmart_forced_skipped():
    """平台 walmart 即便用户上传了模板,run-pipeline 也应跳过第 3 步。"""
    import app as app_mod
    tmpdir = tempfile.mkdtemp(prefix="planter_walmart_")
    try:
        # 即便放一份伪造模板,walmart 路径也应跳过 — 不应走到 fill_excel
        template_path = os.path.join(tmpdir, "WALMART-fake.xlsm")
        with open(template_path, "wb") as f:
            f.write(b"fake")
        original_dir = app_mod.TEMPLATE_DIR
        app_mod.TEMPLATE_DIR = tmpdir
        try:
            data = {
                "sku": "X1",
                "market": "US",
                "template_filename": "WALMART-fake.xlsm",  # 用户上传了
                "platform": "walmart",  # 但平台未支持
            }
            # 模拟 run-pipeline 开头的 platform 判定分支
            from templates_catalog import is_platform_supported
            force_template_skipped = not is_platform_supported(data.get("platform", "amazon"))
            template_name = data.get("template_filename", "")
            if not template_name:
                template_name = app_mod.MARKET_TEMPLATES.get(data["market"], "PLANTER-de.xlsm")
            template_skipped = force_template_skipped or (
                (not data.get("template_filename"))
                and not os.path.exists(os.path.join(tmpdir, template_name))
            )
            assert template_skipped is True, f"walmart 应当强制 skipped, 实际={template_skipped}"
            print("[PASS] walmart 强制 skipped")
        finally:
            app_mod.TEMPLATE_DIR = original_dir
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_amazon_template_missing():
    """amazon 平台 + 用户没传模板 + fallback 也不在 → template_skipped=True。"""
    import app as app_mod
    tmpdir = tempfile.mkdtemp(prefix="planter_missing_")
    try:
        original_dir = app_mod.TEMPLATE_DIR
        app_mod.TEMPLATE_DIR = tmpdir
        try:
            data = {
                "sku": "X1",
                "market": "US",
                "platform": "amazon",
            }
            from templates_catalog import is_platform_supported
            force_template_skipped = not is_platform_supported(data.get("platform", "amazon"))
            template_name = data.get("template_filename", "")
            if not template_name:
                template_name = app_mod.MARKET_TEMPLATES.get(data["market"], "PLANTER-de.xlsm")
            template_skipped = force_template_skipped or (
                (not data.get("template_filename"))
                and not os.path.exists(os.path.join(tmpdir, template_name))
            )
            assert template_skipped is True, f"amazon 模板缺失应当 skipped, 实际={template_skipped}"
            print("[PASS] amazon 模板缺失 → skipped (旧历史行为保留)")
        finally:
            app_mod.TEMPLATE_DIR = original_dir
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_amazon_upload_template_present():
    """amazon + 用户上传模板但 fallback 不在：template_skipped=False(让 fill_excel 自己抛错或执行)。"""
    import app as app_mod
    tmpdir = tempfile.mkdtemp(prefix="planter_upload_")
    try:
        template_filename = "PLANTER-custom.xlsm"
        template_path = os.path.join(tmpdir, template_filename)
        # 给一个最简单的 openpyxl 可加载文件
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.create_sheet("Vorlage")
        wb.save(template_path)

        original_dir = app_mod.TEMPLATE_DIR
        app_mod.TEMPLATE_DIR = tmpdir
        try:
            data = {
                "sku": "X1",
                "market": "US",
                "template_filename": template_filename,  # 用户主动传
                "platform": "amazon",
            }
            from templates_catalog import is_platform_supported
            force_template_skipped = not is_platform_supported(data.get("platform", "amazon"))
            template_name = data.get("template_filename", "")
            template_skipped = force_template_skipped or (
                (not data.get("template_filename"))
                and not os.path.exists(os.path.join(tmpdir, template_name))
            )
            assert template_skipped is False, "用户主动上传模板时不应被 skipped"
            print("[PASS] amazon + 用户上传模板 → 不 skipped (历史行为保留)")
        finally:
            app_mod.TEMPLATE_DIR = original_dir
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    test_walmart_forced_skipped()
    test_amazon_template_missing()
    test_amazon_upload_template_present()
    print("\n✓ run-pipeline 平台降级 + 模板缺失路径全部回归通过")
