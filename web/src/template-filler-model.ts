const STATUS_LABELS: Record<string, string> = {
  missing_required: "缺少必填信息",
  dropdown_required: "需要下拉选择",
  conditional_attention: "条件必填待确认",
  manual_attention: "需要人工确认",
  business_required: "运营必填待补充",
  policy_unconfigured: "需先配置类目策略",
  variant_theme_unresolved: "变体主题无法确认",
  variant_group_too_large: "变体数量超过上限",
  variant_fetch_incomplete: "变体详情不完整",
  variant_manual_theme_conflict: "人工主题与变体不一致",
  variant_associations_skipped: "额外关联编号无法查询",
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

export type VariantSummary = {
  seed_rows: number;
  groups_expanded: number;
  groups_blocked: number;
  parents_added: number;
  children_added: number;
};

export function normalizeVariantSummary(summary?: Partial<VariantSummary>): VariantSummary {
  return {
    seed_rows: summary?.seed_rows ?? 0,
    groups_expanded: summary?.groups_expanded ?? 0,
    groups_blocked: summary?.groups_blocked ?? 0,
    parents_added: summary?.parents_added ?? 0,
    children_added: summary?.children_added ?? 0,
  };
}

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

export type TemplateProgress = "idle" | "analyzing" | "analyzed" | "filling" | "filled";
export type ProgressStepState = "pending" | "active" | "complete";

export function templateProgressState(progress: TemplateProgress): ProgressStepState[] {
  if (progress === "idle") return ["active", "pending", "pending", "pending"];
  if (progress === "analyzing") return ["complete", "active", "pending", "pending"];
  if (progress === "analyzed") return ["complete", "complete", "active", "pending"];
  if (progress === "filling") return ["complete", "complete", "active", "pending"];
  return ["complete", "complete", "complete", "active"];
}

export type ServerStatusLabel = { label: string; ok: boolean };

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function serverStatusLabels(status: unknown): ServerStatusLabel[] {
  const root = recordValue(status);
  const imageStudio = recordValue(root.image_studio);
  const providers = recordValue(imageStudio.providers);
  const gigaMarkets = recordValue(root.giga_markets);
  return [
    { label: "文案优化大模型", ok: providers.minimax === "configured" },
    { label: "生图大模型", ok: providers.laozhang === "configured" },
    { label: "GIGAB2B API", ok: Object.values(gigaMarkets).some(Boolean) },
  ];
}
