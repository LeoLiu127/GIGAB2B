import { describe, expect, it } from "vitest";

import {
  filledSourceLabel,
  isSupportedTemplateFile,
  issueStatusLabel,
  normalizeVariantSummary,
  policyStatusLabel,
  serverStatusLabels,
  templateProgressState,
  uploadReadinessLabel,
  variantGroupResultLabel,
} from "./template-filler-model";


describe("template filler report labels", () => {
  it("uses actionable Chinese labels for missing and dropdown issues", () => {
    expect(issueStatusLabel("missing_required")).toBe("缺少必填信息");
    expect(issueStatusLabel("dropdown_required")).toBe("需要下拉选择");
    expect(issueStatusLabel("conditional_attention")).toBe("条件必填待确认");
    expect(issueStatusLabel("manual_attention")).toBe("需要人工确认");
    expect(issueStatusLabel("business_required")).toBe("运营必填待补充");
    expect(issueStatusLabel("policy_unconfigured")).toBe("需先配置类目策略");
    expect(issueStatusLabel("variant_theme_unresolved")).toBe("变体主题无法确认");
    expect(issueStatusLabel("variant_fetch_incomplete")).toBe("变体详情不完整");
    expect(issueStatusLabel("variant_associations_skipped")).toBe("额外关联编号无法查询");
  });

  it("labels template policy states for the rule editor", () => {
    expect(policyStatusLabel("active")).toBe("策略已生效");
    expect(policyStatusLabel("unconfigured")).toBe("尚未配置策略");
    expect(policyStatusLabel("drift_detected")).toBe("模板结构已变化");
  });

  it("labels GIGA values and explicit business defaults", () => {
    expect(filledSourceLabel("business_default")).toBe("业务默认值");
    expect(filledSourceLabel("giga_api")).toBe("GIGA API");
  });

  it("distinguishes upload-ready and incomplete workbooks", () => {
    expect(uploadReadinessLabel(true)).toBe("可以进入下一步审核");
    expect(uploadReadinessLabel(false)).toBe("尚不可直接上传 Amazon");
  });

  it("accepts only Amazon workbook extensions", () => {
    expect(isSupportedTemplateFile("CABINET-UK.xlsm")).toBe(true);
    expect(isSupportedTemplateFile("CHAIR-UK.XLSX")).toBe(true);
    expect(isSupportedTemplateFile("legacy.xls")).toBe(false);
  });

  it("treats a legacy fill response without variant statistics as zero", () => {
    expect(normalizeVariantSummary(undefined)).toEqual({
      seed_rows: 0,
      groups_expanded: 0,
      groups_blocked: 0,
      parents_added: 0,
      children_added: 0,
    });
  });

  it("keeps returned variant statistics and defaults omitted counters", () => {
    expect(normalizeVariantSummary({ children_added: 4, groups_blocked: 1 })).toEqual({
      seed_rows: 0,
      groups_expanded: 0,
      groups_blocked: 1,
      parents_added: 0,
      children_added: 4,
    });
  });

  it("reports complete effective children separately from inaccessible associations", () => {
    expect(variantGroupResultLabel({
      status: "expanded",
      message: "legacy warning",
      expected_children: 3,
      actual_children: 3,
      skipped_association_skus: ["P1", "P2"],
      collection_status: "complete",
    })).toBe("采集完整：预计 3 个有效子体，实际生成 3 个子体。GIGA 另返回 2 个无法查询商品详情的关联编号，未计入有效子体：P1、P2。");
  });

  it("reports expected versus actual counts when a group is blocked", () => {
    expect(variantGroupResultLabel({
      status: "blocked",
      message: "变体主题无法确认",
      expected_children: 3,
      actual_children: 0,
      collection_status: "incomplete",
    })).toBe("采集不完整：预计 3 个有效子体，实际生成 0 个子体。阻断原因：变体主题无法确认");
  });

  it("keeps legacy variant group responses compatible", () => {
    expect(variantGroupResultLabel({status: "expanded", message: "legacy warning"}))
      .toBe("已展开：legacy warning");
  });

  it("maps workflow progress to four deterministic visual steps", () => {
    expect(templateProgressState("idle")).toEqual(["active", "pending", "pending", "pending"]);
    expect(templateProgressState("analyzing")).toEqual(["complete", "active", "pending", "pending"]);
    expect(templateProgressState("analyzed")).toEqual(["complete", "complete", "active", "pending"]);
    expect(templateProgressState("filling")).toEqual(["complete", "complete", "active", "pending"]);
    expect(templateProgressState("filled")).toEqual(["complete", "complete", "complete", "active"]);
  });

  it("formats optional server status without blocking the template workflow", () => {
    expect(serverStatusLabels(null)).toEqual([
      { label: "文案优化大模型", ok: false },
      { label: "生图大模型", ok: false },
      { label: "GIGAB2B API", ok: false },
    ]);
    expect(serverStatusLabels({
      image_studio: {
        providers: {
          minimax: "configured",
          laozhang: "missing",
        },
      },
      giga_markets: { UK: true },
    })).toEqual([
      { label: "文案优化大模型", ok: true },
      { label: "生图大模型", ok: false },
      { label: "GIGAB2B API", ok: true },
    ]);
  });
});
