# Template Filler Main Variant Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Amazon template filling reuse main's validated Listing collector so inaccessible historical associations do not block valid CABINET or CHAIR variants.

**Architecture:** Extend `giga_fetch_listing` with additive internal metadata while preserving its current public behavior. Convert that shared result into the template engine's raw `ListingProducts` contract, then report skipped associations as a non-blocking warning while retaining blocking behavior for bulk failures and over-limit groups.

**Tech Stack:** Python 3.11, Flask, unittest, TypeScript, Vitest, Vite, openpyxl, GIGA detailInfo API.

## Global Constraints

- Do not rewrite the existing GIGA API or `/api/fetch-listing` public response.
- Preserve full raw product records for template mapping.
- `B20003` and empty historical associations are warnings, not blockers.
- Network failures, bulk request failures, groups over 200, and genuinely incomplete effective groups remain blockers.
- Preserve XLSM macros, hidden sheets, validations, control rows, and existing download behavior.
- Validate both `CABINET-UK-1SKU.xlsm` and `CHAIR-UK-1SKU.xlsm` with live GIGA data.

---

### Task 1: Shared Listing Collector Metadata and Template Adapter

**Files:**
- Modify: `tests/test_template_filler_variants.py:54-75`
- Modify: `app.py:725-917`

**Interfaces:**
- Consumes: `giga_fetch_product(sku: str, market: str) -> dict` and `giga_fetch_products_bulk(skus: list, market: str) -> list`.
- Produces: additive `giga_fetch_listing` keys `raw_products`, `requested_skus`, `skipped_skus`, `truncated`, and `fetch_error`; preserves all existing keys.
- Produces: `giga_fetch_listing_products(seed_sku: str, market: str) -> dict` using only `giga_fetch_listing` output.

- [ ] **Step 1: Replace the old missing-SKU test with a failing shared-collector test**

```python
def test_template_listing_fetch_reuses_main_collector_and_skips_unavailable_associations(self):
    original_listing = app_module.giga_fetch_listing
    calls = []
    try:
        def fake_listing(sku, market, include_variants=True):
            calls.append((sku, market, include_variants))
            return {
                "parent_sku": sku,
                "main": {"sku": "A", "productName": "A"},
                "variants": [],
                "raw_products": [
                    {"sku": "A", "productName": "A"},
                    {"sku": "B", "productName": "B"},
                ],
                "requested_skus": ["A", "B", "C", "D"],
                "skipped_skus": ["C", "D"],
                "truncated": False,
                "fetch_error": None,
                "warning": None,
            }
        app_module.giga_fetch_listing = fake_listing
        listing = app_module.giga_fetch_listing_products("A", "UK")
    finally:
        app_module.giga_fetch_listing = original_listing

    self.assertEqual(calls, [("A", "UK", True)])
    self.assertEqual(listing["requested_skus"], ["A", "B"])
    self.assertEqual([item["sku"] for item in listing["products"]], ["A", "B"])
    self.assertEqual(listing["missing_skus"], [])
    self.assertIn("C", listing["warning"])
    self.assertIn("D", listing["warning"])
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `python -m unittest tests.test_template_filler_variants.VariantExpansionTests.test_template_listing_fetch_reuses_main_collector_and_skips_unavailable_associations -v`

Expected: FAIL because `giga_fetch_listing_products` still calls `giga_fetch_product` directly instead of the patched shared collector.

- [ ] **Step 3: Add a failing metadata test for main's collector**

```python
def test_main_listing_collector_exposes_raw_products_and_skipped_skus(self):
    original_product = app_module.giga_fetch_product
    original_bulk = app_module.giga_fetch_products_bulk
    try:
        app_module.giga_fetch_product = lambda sku, market: {
            "sku": "A", "productName": "A", "associateProductList": ["B", "C"]
        }
        app_module.giga_fetch_products_bulk = lambda skus, market: [
            {"sku": "A", "productName": "A"},
            {"sku": "B", "productName": "B"},
        ]
        listing = app_module.giga_fetch_listing("A", "UK")
    finally:
        app_module.giga_fetch_product = original_product
        app_module.giga_fetch_products_bulk = original_bulk

    self.assertEqual([item["sku"] for item in listing["raw_products"]], ["A", "B"])
    self.assertEqual(listing["requested_skus"], ["A", "B", "C"])
    self.assertEqual(listing["skipped_skus"], ["C"])
    self.assertFalse(listing["truncated"])
    self.assertIsNone(listing["fetch_error"])
```

- [ ] **Step 4: Run the metadata test and confirm RED**

Run: `python -m unittest tests.test_template_filler_variants.VariantExpansionTests.test_main_listing_collector_exposes_raw_products_and_skipped_skus -v`

Expected: FAIL with missing `raw_products`.

- [ ] **Step 5: Add additive metadata to every `giga_fetch_listing` return path**

For successful bulk fetch, retain usable raw records and skipped candidates:

```python
usable_items: dict[str, dict] = {}
skipped: list[str] = []
for sku in requested_skus:
    item = main_item if sku == parent_sku else by_sku.get(sku)
    if item and (
        (item.get("productName") or "").strip()
        or item.get("imageUrls")
        or item.get("attributes")
    ):
        usable_items[sku] = item
    else:
        skipped.append(sku)

result.update({
    "raw_products": [usable_items[sku] for sku in requested_skus if sku in usable_items],
    "requested_skus": requested_skus,
    "skipped_skus": skipped,
    "truncated": truncated,
    "fetch_error": None,
})
```

For no-sibling and disabled expansion paths, use one raw main record and empty skipped/error metadata. For bulk exceptions, preserve the existing warning and return `fetch_error=str(exc)` with only the main raw record.

- [ ] **Step 6: Replace duplicate template discovery with the shared adapter**

```python
def giga_fetch_listing_products(seed_sku: str, market: str) -> dict:
    listing = giga_fetch_listing(seed_sku, market, include_variants=True)
    raw_products = [
        item for item in listing.get("raw_products") or []
        if isinstance(item, dict) and item.get("sku")
    ]
    effective_skus = [str(item["sku"]).strip() for item in raw_products]
    skipped_skus = [str(sku).strip() for sku in listing.get("skipped_skus") or [] if str(sku).strip()]
    fetch_error = str(listing.get("fetch_error") or "").strip()
    warning = None
    if skipped_skus:
        warning = f"已忽略 {len(skipped_skus)} 个 GIGA 不可访问关联 SKU: {', '.join(skipped_skus)}"
    if fetch_error:
        warning = f"GIGA 关联 SKU 批量请求失败: {fetch_error}"
    return {
        "seed_sku": seed_sku,
        "main": listing.get("main") or {},
        "requested_skus": effective_skus or [seed_sku],
        "products": raw_products,
        "missing_skus": [seed_sku] if fetch_error else [],
        "over_limit": bool(listing.get("truncated")),
        "warning": warning,
    }
```

- [ ] **Step 7: Run focused backend tests and confirm GREEN**

Run: `python -m unittest tests.test_template_filler_variants.VariantExpansionTests.test_template_listing_fetch_reuses_main_collector_and_skips_unavailable_associations tests.test_template_filler_variants.VariantExpansionTests.test_main_listing_collector_exposes_raw_products_and_skipped_skus -v`

Expected: both tests PASS.

- [ ] **Step 8: Commit the shared collector implementation**

```bash
git add app.py tests/test_template_filler_variants.py
git commit -m "fix: reuse main listing variant collector"
```

### Task 2: Non-Blocking Skipped-Association Reporting

**Files:**
- Modify: `tests/test_template_filler_variants.py:74-145`
- Modify: `template_filler/variants.py:150-236`
- Modify: `web/src/template-filler-model.ts:1-18`
- Modify: `web/src/template-filler-model.test.ts:10-25`
- Modify: `web/src/template-filler.ts:302-324`

**Interfaces:**
- Consumes: successful `ListingProducts.warning` from Task 1.
- Produces: `variant_associations_skipped` warning issue and successful `VariantGroup.message`.

- [ ] **Step 1: Write a failing expansion warning test**

```python
def test_expands_effective_variants_and_reports_skipped_associations_as_warning(self):
    products = {
        "A": {"sku": "A", "mainColor": "Red", "mainMaterial": "Wood"},
        "B": {"sku": "B", "mainColor": "Blue", "mainMaterial": "Steel"},
    }
    listing = ListingProducts(
        seed_sku="A", main_sku="A", requested_skus=("A", "B"), products=products,
        warning="已忽略 2 个 GIGA 不可访问关联 SKU: C, D",
    )

    expansion = expand_variant_rows(_profile(), lambda _sku, _market: listing)

    self.assertEqual(expansion.summary["groups_expanded"], 1)
    self.assertEqual(expansion.summary["groups_blocked"], 0)
    self.assertEqual([issue.status for issue in expansion.issues], ["variant_associations_skipped"])
    self.assertEqual(expansion.issues[0].severity, "warning")
    self.assertIn("C, D", expansion.groups[0].message)
```

- [ ] **Step 2: Run the expansion test and confirm RED**

Run: `python -m unittest tests.test_template_filler_variants.VariantExpansionTests.test_expands_effective_variants_and_reports_skipped_associations_as_warning -v`

Expected: FAIL because successful warnings are currently discarded.

- [ ] **Step 3: Implement warning issue creation after successful theme validation**

```python
def _warning_issue(seed: SkuRow, status: str, message: str) -> ValidationIssue:
    return ValidationIssue(
        sku=seed.sku,
        row=seed.row,
        field_id="__variant_expansion__",
        label="Variant Expansion",
        severity="warning",
        status=status,
        message=message,
    )

# After theme and manual-theme checks, before materializing the parent:
if listing.warning:
    result.issues.append(_warning_issue(seed, "variant_associations_skipped", listing.warning))

result.groups.append(
    VariantGroup(seed.sku, parent_sku, listing.requested_skus, theme, message=listing.warning or "")
)
```

- [ ] **Step 4: Add a failing frontend label test**

```typescript
expect(issueStatusLabel("variant_associations_skipped")).toBe("已忽略无效关联 SKU");
```

Run: `npm test -- --run src/template-filler-model.test.ts`

Expected: FAIL because the status label is not registered.

- [ ] **Step 5: Register the label and show successful group warnings**

```typescript
// template-filler-model.ts
variant_associations_skipped: "已忽略无效关联 SKU",

// template-filler.ts
const groupStatus = group.status === "expanded"
  ? group.message ? `已展开：${group.message}` : "已展开"
  : `${group.status}：${group.message}`;
```

- [ ] **Step 6: Run focused backend and frontend tests and confirm GREEN**

Run: `python -m unittest tests.test_template_filler_variants.VariantExpansionTests.test_expands_effective_variants_and_reports_skipped_associations_as_warning -v`

Run: `npm test -- --run src/template-filler-model.test.ts` from `web/`.

Expected: both PASS.

- [ ] **Step 7: Commit non-blocking warning reporting**

```bash
git add template_filler/variants.py tests/test_template_filler_variants.py web/src/template-filler-model.ts web/src/template-filler-model.test.ts web/src/template-filler.ts
git commit -m "feat: report skipped listing associations"
```

### Task 3: Full Regression and Live CABINET/CHAIR Verification

**Files:**
- Verify: `input/CABINET-UK-1SKU.xlsm`
- Verify: `input/CHAIR-UK-1SKU.xlsm`
- Generated runtime artifacts only: `.runtime/excel/*`

**Interfaces:**
- Consumes: `/api/template-filler/analyze` and `/api/template-filler/fill` with `expand_variants=true`.
- Produces: JSON reports containing non-blocked variant summaries for both templates when GIGA exposes at least two effective variants and a resolvable template theme.

- [ ] **Step 1: Run the complete automated backend suite**

Run: `python -m unittest discover -s tests -q`

Expected: all tests PASS; existing environment-dependent skips are allowed.

- [ ] **Step 2: Run frontend tests and production build**

Run from `web/`: `npm test`

Run from `web/`: `npm run build`

Expected: all tests PASS and Vite build exits 0.

- [ ] **Step 3: Restart the 5182 backend from the feature worktree**

Stop only the PID listening on `127.0.0.1:5182`, verify it is the Python backend, then launch `python app.py` from the feature worktree with the main project `.env` loaded. Use a hidden background window and verify `/api/health` returns `status=ok` and `has_giga_creds=true`.

- [ ] **Step 4: Execute live CABINET fill with variant expansion enabled**

Upload `F:\AI Projects\GIGAB2B\input\CABINET-UK-1SKU.xlsm`, call fill with `expand_variants=true`, and assert:

```text
variant_summary.groups_blocked == 0
variant_summary.groups_expanded == 1
variant_summary.children_added == 2
variant_groups[0].child_skus contains N890P39984041W and N890P39976566W
issues contains variant_associations_skipped for N890P399840W and N890P399841W
issues does not contain variant_fetch_incomplete
```

- [ ] **Step 5: Execute live CHAIR fill with variant expansion enabled**

Upload `F:\AI Projects\GIGAB2B\input\CHAIR-UK-1SKU.xlsm`, call fill with `expand_variants=true`, and assert:

```text
variant_summary.groups_blocked == 0
variant_summary.groups_expanded == 1
variant_summary.children_added >= 2
issues does not contain variant_fetch_incomplete
```

If CHAIR is blocked for `variant_theme_unresolved`, report the exact effective SKUs and missing theme attributes; do not misclassify that as a collector failure.

- [ ] **Step 6: Verify workbook preservation and working tree quality**

Run: `git diff --check`

Open both generated XLSM files with `openpyxl.load_workbook(..., keep_vba=True)` and assert VBA archive exists, hidden-sheet states match the source, the Template sheet remains present, and materialized row counts match each `variant_summary`.

- [ ] **Step 7: Commit any verification-only test corrections, then report results**

If no source correction is required, do not create an empty commit. Report exact child SKUs, theme, warning statuses, automated test counts, build result, and live output filenames.
