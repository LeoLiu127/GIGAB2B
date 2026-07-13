import { describe, expect, it } from "vitest";

import { filledSourceLabel, isSupportedTemplateFile, issueStatusLabel, policyStatusLabel, uploadReadinessLabel } from "./template-filler-model";


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
});
