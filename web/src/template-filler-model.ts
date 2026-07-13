const STATUS_LABELS: Record<string, string> = {
  missing_required: "缺少必填信息",
  dropdown_required: "需要下拉选择",
  conditional_attention: "条件必填待确认",
  invalid_existing_value: "现有值不符合下拉规则",
  api_not_found: "GIGA 未返回该 SKU",
  preserved: "已保留人工填写值",
};

export function issueStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function uploadReadinessLabel(uploadReady: boolean): string {
  return uploadReady ? "可以进入下一步审核" : "尚不可直接上传 Amazon";
}

export function isSupportedTemplateFile(filename: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(filename);
}
