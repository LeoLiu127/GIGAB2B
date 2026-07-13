# UK Template Filler Defaults and Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply approved Amazon UK defaults, report only actionable exceptions, and display the exact fields written to each filled template.

**Architecture:** Keep field candidates and business defaults in `template_filler.mapping`; add explicit write provenance to `FillPlan`; serialize it from the existing blueprint. The static template-filler page consumes the added `filled_fields` response without changing the existing GIGA API or XLSM writer boundary.

**Tech Stack:** Python 3.11, Flask, openpyxl for read-only planning, direct OOXML XLSM writer, TypeScript, Vite, unittest, Vitest.

## Global Constraints

- Preserve an existing non-empty operator cell.
- Validate all dropdown defaults against the uploaded template allowed values.
- `GENERIC`, `GTIN Exempt`, `New`, `China`, `No`, and Quantity `5`/`0` are explicit UK business defaults.
- Do not use assembled dimensions or weight as package dimensions or package weight.
- Do not modify the legacy PLANTER pipeline or existing GIGA API transport.
- Preserve XLSM macros, hidden sheets, validations, and non-target ZIP parts.

---

### Task 1: Capture write provenance and test UK defaults

**Files:**
- Modify: `template_filler/models.py`
- Modify: `template_filler/mapping.py`
- Modify: `tests/test_template_filler.py`

**Interfaces:**
- Produces `FilledField` records and `FillPlan.filled_fields`.
- `build_fill_plan(...)` records source `giga_api` or `business_default` for every planned change.

- [ ] **Step 1: Write failing tests**

```python
self.assertEqual(planned("brand"), "GENERIC")
self.assertEqual(planned("amzn1.volt.ca.product_id_type"), "GTIN Exempt")
self.assertEqual(planned("condition_type"), "New")
self.assertEqual(planned("country_of_origin"), "China")
self.assertEqual(planned("batteries_required"), "No")
self.assertEqual(planned("batteries_included"), "No")
self.assertEqual(planned("fulfillment_availability"), 5)
self.assertTrue(any(item.source == "business_default" for item in plan.filled_fields))
```

- [ ] **Step 2: Run failing tests**

Run: `python -m unittest tests.test_template_filler.AmazonTemplateFillTests -v`

Expected: failures for absent defaults and `filled_fields`.

- [ ] **Step 3: Implement the minimal mapping and provenance model**

```python
@dataclass(frozen=True)
class FilledField:
    sku: str
    row: int
    field_id: str
    label: str
    value: Any
    source: str
```

Implement a candidate source helper that selects `business_default` for approved UK defaults and `giga_api` for existing safe product fields.

- [ ] **Step 4: Run the focused tests**

Run: `python -m unittest tests.test_template_filler.AmazonTemplateFillTests -v`

Expected: all tests pass.

### Task 2: Replace conditional-field noise with actionable reminders

**Files:**
- Modify: `template_filler/mapping.py`
- Modify: `tests/test_template_filler.py`

**Interfaces:**
- Produces `manual_attention` issues for blank `recommended_browse_nodes` and `manufacturer`.
- Suppresses generic `conditional_attention` issues for unconfigured fields.

- [ ] **Step 1: Write failing tests**

```python
self.assertTrue(any(issue.status == "manual_attention" and issue.field_id.startswith("recommended_browse_nodes") for issue in plan.issues))
self.assertTrue(any(issue.status == "manual_attention" and issue.field_id.startswith("manufacturer") for issue in plan.issues))
self.assertFalse(any(issue.status == "conditional_attention" for issue in plan.issues))
```

- [ ] **Step 2: Run failing tests**

Run: `python -m unittest tests.test_template_filler.AmazonTemplateFillTests -v`

Expected: failure because the current implementation emits every empty conditional field.

- [ ] **Step 3: Implement targeted reminders**

```python
MANUAL_ATTENTION_FIELDS = {"recommended_browse_nodes", "manufacturer"}
```

Emit the reminder only when the final target cell is empty; keep strict required and dropdown validation unchanged.

- [ ] **Step 4: Run focused tests**

Run: `python -m unittest tests.test_template_filler.AmazonTemplateFillTests -v`

Expected: all tests pass.

### Task 3: Serialize filled fields and render them before issues

**Files:**
- Modify: `template_filler/routes.py`
- Modify: `web/template-filler.html`
- Modify: `web/src/template-filler.ts`
- Modify: `web/src/template-filler-model.ts`
- Modify: `web/src/template-filler-model.test.ts`

**Interfaces:**
- `/api/template-filler/fill` returns `filled_fields: FilledField[]`.
- `renderResult` renders an “已填写内容” table before “需要处理的字段”.

- [ ] **Step 1: Write failing backend and frontend tests**

```python
self.assertIn("filled_fields", payload)
self.assertTrue(payload["filled_fields"])
```

```ts
expect(filledSourceLabel("business_default")).toBe("业务默认值");
expect(filledSourceLabel("giga_api")).toBe("GIGA API");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m unittest tests.test_template_filler.TemplateFillerApiTests -v`

Run: `npm test -- template-filler-model.test.ts`

Expected: failure because `filled_fields` and source labels do not exist.

- [ ] **Step 3: Implement response and UI table**

Add a compact table with SKU, label, written value, and source. Keep the JSON download and existing issue filter unchanged.

- [ ] **Step 4: Run focused tests**

Run: `python -m unittest tests.test_template_filler.TemplateFillerApiTests -v`

Run: `npm test -- template-filler-model.test.ts`

Expected: all tests pass.

### Task 4: Verify workbook preservation and real UK templates

**Files:**
- Test: `tests/test_template_filler.py`

- [ ] **Step 1: Run backend suite**

Run: `python -m unittest discover -s tests`

Expected: all backend tests pass.

- [ ] **Step 2: Run frontend suite and production build**

Run: `npm test`

Run: `npm run build`

Expected: all Vitest tests and TypeScript/Vite build pass.

- [ ] **Step 3: Execute real API end-to-end checks**

Upload and fill `CABINET-UK-1SKU.xlsm` and `CHAIR-UK-1SKU.xlsm`; inspect output reports for `filled_fields`; compare XLSM validation counts and non-target ZIP parts.

- [ ] **Step 4: Commit**

```bash
git add template_filler tests web docs/superpowers
git commit -m "feat: apply UK template defaults and filled report"
```
