# Variant Collection Result Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report whether all expected effective GIGA child products were materialized, while separately identifying inaccessible association references that are not counted as effective children.

**Architecture:** Preserve inaccessible association identifiers as structured data from the shared GIGA listing collector through the Flask route and variant domain model. The backend records expected and actual child counts on each variant group; the frontend formats those fields through a pure compatibility helper instead of interpreting a Chinese warning string.

**Tech Stack:** Python 3, Flask, dataclasses, unittest, TypeScript, Vitest, Vite.

## Global Constraints

- `expected_children` counts only SKU records with usable GIGA product details.
- `skipped_association_skus` never contributes to `expected_children`.
- Equal expected and actual counts display `collection_status=complete`; fewer actual rows display `collection_status=incomplete`.
- Inaccessible association references remain a nonblocking warning and must not be described as missing variants, invalid products, parent products, or historical records.
- Existing `message` fields and legacy frontend responses remain compatible.
- CABINET and CHAIR real-template behavior must remain unchanged except for the clearer result text.

---

### Task 1: Carry structured collection counts through the backend

**Files:**
- Modify: `tests/test_template_filler_variants.py`
- Modify: `app.py`
- Modify: `template_filler/routes.py`
- Modify: `template_filler/variants.py`

**Interfaces:**
- Consumes: `giga_fetch_listing()` metadata keys `raw_products`, `requested_skus`, `skipped_skus`, `truncated`, and `fetch_error`.
- Produces: `ListingProducts.skipped_skus: tuple[str, ...]` and additive `VariantGroup` response fields `expected_children`, `actual_children`, `skipped_association_skus`, and `collection_status`.

- [ ] **Step 1: Write failing adapter and expansion tests**

Extend `test_template_listing_fetch_reuses_main_collector_and_skips_unavailable_associations` with:

```python
self.assertEqual(listing["skipped_skus"], ["C", "D"])
self.assertIn("未计入有效子体", listing["warning"])
```

Update `test_expands_effective_variants_and_reports_skipped_associations_as_warning` to construct structured data and assert the public payload:

```python
listing = ListingProducts(
    seed_sku="A",
    main_sku="A",
    requested_skus=("A", "B"),
    products=products,
    skipped_skus=("C", "D"),
)

group = expansion.groups[0].to_dict()
self.assertEqual(group["expected_children"], 2)
self.assertEqual(group["actual_children"], 2)
self.assertEqual(group["skipped_association_skus"], ["C", "D"])
self.assertEqual(group["collection_status"], "complete")
self.assertIn("预计 2 个有效子体，实际生成 2 个子体", group["message"])
self.assertIn("未计入有效子体", expansion.issues[0].message)
```

Add a blocked-group test proving a group with two effective products and no resolved theme reports `expected_children=2`, `actual_children=0`, and `collection_status=incomplete`.

- [ ] **Step 2: Run the focused backend tests and verify RED**

Run:

```powershell
python -m unittest tests.test_template_filler_variants.VariantExpansionTests.test_template_listing_fetch_reuses_main_collector_and_skips_unavailable_associations tests.test_template_filler_variants.VariantExpansionTests.test_expands_effective_variants_and_reports_skipped_associations_as_warning tests.test_template_filler_variants.VariantExpansionTests.test_blocked_group_reports_expected_and_actual_child_counts -v
```

Expected: failures because `skipped_skus` and the four additive `VariantGroup` fields do not exist yet.

- [ ] **Step 3: Implement the structured backend contract**

In `app.py`, return `skipped_skus` from `giga_fetch_listing_products` and format the warning without calling the identifiers missing variants:

```python
if skipped_skus and not fetch_error and not listing.get("truncated"):
    warning = (
        f"GIGA 另返回 {len(skipped_skus)} 个无法查询商品详情的关联编号，"
        f"未计入有效子体: {', '.join(skipped_skus)}"
    )

return {
    # existing keys remain unchanged
    "skipped_skus": skipped_skus,
}
```

In `template_filler/routes.py`, pass the optional array into the domain model:

```python
skipped_skus=tuple(
    str(item).strip()
    for item in raw.get("skipped_skus") or []
    if str(item).strip()
),
```

In `template_filler/variants.py`, extend the dataclasses:

```python
@dataclass(frozen=True)
class ListingProducts:
    # existing fields
    skipped_skus: tuple[str, ...] = ()

@dataclass(frozen=True)
class VariantGroup:
    # existing fields
    expected_children: int = 0
    actual_children: int = 0
    skipped_association_skus: tuple[str, ...] = ()
    collection_status: str = "incomplete"
```

Add a focused formatter:

```python
def collection_result_message(expected: int, actual: int, skipped_skus: tuple[str, ...] = ()) -> str:
    state = "采集完整" if actual == expected else "采集不完整"
    result = f"{state}：预计 {expected} 个有效子体，实际生成 {actual} 个子体。"
    if skipped_skus:
        result += (
            f"GIGA 另返回 {len(skipped_skus)} 个无法查询商品详情的关联编号，"
            f"未计入有效子体：{'、'.join(skipped_skus)}。"
        )
    return result
```

Populate all group outcomes with `expected_children=len(listing.requested_skus)`, the number of generated child rows for `actual_children`, the structured skipped identifiers, and `collection_status`. Successful groups use `collection_result_message` as `message`; blocked groups retain their blocking reason while exposing counts separately. The warning issue uses only the extra-association sentence from the same structured source.

- [ ] **Step 4: Run focused and full backend tests and verify GREEN**

Run:

```powershell
python -m unittest tests.test_template_filler_variants -v
python -m unittest discover -s tests -q
```

Expected: variant tests pass; full suite passes with the repository's existing skipped tests only.

- [ ] **Step 5: Commit backend behavior**

```powershell
git add -- app.py template_filler/routes.py template_filler/variants.py tests/test_template_filler_variants.py
git commit -m "feat: report complete effective variant collection"
```

---

### Task 2: Render unambiguous result text with legacy compatibility

**Files:**
- Modify: `web/src/template-filler-model.ts`
- Modify: `web/src/template-filler-model.test.ts`
- Modify: `web/src/template-filler.ts`

**Interfaces:**
- Consumes: optional `VariantGroup` fields produced by Task 1.
- Produces: `variantGroupResultLabel(group)` used by the result table; legacy response objects still render without throwing.

- [ ] **Step 1: Write failing frontend label tests**

Add tests for a pure formatter in `template-filler-model.test.ts`:

```typescript
expect(variantGroupResultLabel({
  status: "expanded",
  message: "legacy warning",
  expected_children: 3,
  actual_children: 3,
  skipped_association_skus: ["P1", "P2"],
  collection_status: "complete",
})).toBe("采集完整：预计 3 个有效子体，实际生成 3 个子体。GIGA 另返回 2 个无法查询商品详情的关联编号，未计入有效子体：P1、P2。")

expect(variantGroupResultLabel({
  status: "blocked",
  message: "变体主题无法确认",
  expected_children: 3,
  actual_children: 0,
  collection_status: "incomplete",
})).toBe("采集不完整：预计 3 个有效子体，实际生成 0 个子体。阻断原因：变体主题无法确认")

expect(variantGroupResultLabel({status: "expanded", message: "legacy warning"}))
  .toBe("已展开：legacy warning")
```

Also change the warning label assertion to:

```typescript
expect(issueStatusLabel("variant_associations_skipped")).toBe("额外关联编号无法查询")
```

- [ ] **Step 2: Run frontend tests and verify RED**

Run:

```powershell
npm test -- --run web/src/template-filler-model.test.ts
```

from the `web` directory.

Expected: failure because `variantGroupResultLabel` is not exported and the old warning label remains.

- [ ] **Step 3: Implement the pure formatter and use it in the table**

In `template-filler-model.ts`, export a compatible input type and formatter:

```typescript
export type VariantGroupResult = {
  status: string;
  message?: string;
  expected_children?: number;
  actual_children?: number;
  skipped_association_skus?: string[];
  collection_status?: string;
};

export function variantGroupResultLabel(group: VariantGroupResult): string {
  if (typeof group.expected_children !== "number" || typeof group.actual_children !== "number") {
    return group.status === "expanded"
      ? group.message ? `已展开：${group.message}` : "已展开"
      : `${group.status}：${group.message ?? ""}`;
  }
  const complete = group.actual_children === group.expected_children;
  let text = `${complete ? "采集完整" : "采集不完整"}：预计 ${group.expected_children} 个有效子体，实际生成 ${group.actual_children} 个子体。`;
  const skipped = group.skipped_association_skus ?? [];
  if (skipped.length) {
    text += `GIGA 另返回 ${skipped.length} 个无法查询商品详情的关联编号，未计入有效子体：${skipped.join("、")}。`;
  }
  if (!complete && group.message) text += `阻断原因：${group.message}`;
  return text;
}
```

Update `STATUS_LABELS.variant_associations_skipped` to `额外关联编号无法查询`. Extend the local `VariantGroup` type in `template-filler.ts` with the four optional fields and replace the inline `groupStatus` expression with `variantGroupResultLabel(group)`.

- [ ] **Step 4: Run frontend tests and production build and verify GREEN**

Run from `web`:

```powershell
npm test
npm run build
```

Expected: all Vitest files pass and Vite finishes a production build without TypeScript errors.

- [ ] **Step 5: Commit frontend behavior**

```powershell
git add -- web/src/template-filler-model.ts web/src/template-filler-model.test.ts web/src/template-filler.ts
git commit -m "feat: clarify variant collection results"
```

---

### Task 3: Verify real CABINET and CHAIR flows

**Files:**
- Verify only: `input/CABINET-UK-1SKU.xlsm`
- Verify only: `input/CHAIR-UK-1SKU.xlsm`
- Verify generated reports under `.runtime/excel/`

**Interfaces:**
- Consumes: `/api/template-filler/analyze` and `/api/template-filler/fill`.
- Produces: evidence that the new contract matches live GIGA results and workbook materialization.

- [ ] **Step 1: Restart only the feature backend if source reload is not active**

Start `python app.py` from the feature worktree with the repository root `.env` loaded, preserving frontend port `5175` and backend port `5182`.

- [ ] **Step 2: Run both real templates through analyze and fill**

For each source template, upload to `/api/template-filler/analyze`, then call `/api/template-filler/fill` with `expand_variants=true`. Save the returned report paths.

- [ ] **Step 3: Assert exact live variant outcomes**

CHAIR expected assertions:

```text
groups_expanded = 1
groups_blocked = 0
children_added = 3
expected_children = 3
actual_children = 3
collection_status = complete
child_skus = W5807S00002, W5807S00004, W5807S00003
skipped_association_skus = W5807P482051, W5807P482049
message explicitly says the skipped identifiers are not counted as effective children
```

CABINET expected assertions:

```text
groups_expanded = 1
groups_blocked = 0
children_added = 2
expected_children = 2
actual_children = 2
collection_status = complete
child_skus = N890P39984041W, N890P39976566W
skipped_association_skus = N890P399840W, N890P399841W
message explicitly says the skipped identifiers are not counted as effective children
```

- [ ] **Step 4: Run final repository verification**

```powershell
python -m py_compile app.py template_filler/*.py
python -m unittest discover -s tests -q
Set-Location web
npm test
npm run build
Set-Location ..
git diff --check
git status --short
```

Expected: Python compilation succeeds, backend and frontend tests pass, production build succeeds, no whitespace errors remain, and the worktree is clean after commits.

