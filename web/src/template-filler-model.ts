const STATUS_LABELS: Record<string, string> = {
  missing_required: "缺少必填信息",
  dropdown_required: "需要下拉选择",
  conditional_attention: "条件必填待确认",
  manual_attention: "需要人工确认",
  business_required: "运营必填待补充",
  policy_unconfigured: "需先配置类目策略",
  invalid_existing_value: "现有值不符合下拉规则",
  api_not_found: "GIGA 未返回该 SKU",
  preserved: "已保留人工填写值",
};

export function issueStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function filledSourceLabel(source: string): string {
  return source === "business_default" ? "业务默认值" : source === "template_policy" ? "模板策略默认值" : source === "giga_api" ? "GIGA API" : source;
}

export function policyStatusLabel(status: string): string {
  return status === "active" ? "策略已生效" : status === "unconfigured" ? "尚未配置策略" : status === "drift_detected" ? "模板结构已变化" : status;
}

export function uploadReadinessLabel(uploadReady: boolean): string {
  return uploadReady ? "可以进入下一步审核" : "尚不可直接上传 Amazon";
}

export function isSupportedTemplateFile(filename: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(filename);
}
