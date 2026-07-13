import { describe, expect, it } from "vitest";

import { filledSourceLabel, isSupportedTemplateFile, issueStatusLabel, uploadReadinessLabel } from "./template-filler-model";


describe("template filler report labels", () => {
  it("uses actionable Chinese labels for missing and dropdown issues", () => {
    expect(issueStatusLabel("missing_required")).toBe("缺少必填信息");
    expect(issueStatusLabel("dropdown_required")).toBe("需要下拉选择");
    expect(issueStatusLabel("conditional_attention")).toBe("条件必填待确认");
    expect(issueStatusLabel("manual_attention")).toBe("需要人工确认");
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
