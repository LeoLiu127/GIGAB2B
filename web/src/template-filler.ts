import "./template-filler.css";
import {
  filledSourceLabel,
  isSupportedTemplateFile,
  issueStatusLabel,
  normalizeVariantSummary,
  policyStatusLabel,
  uploadReadinessLabel,
  variantGroupResultLabel,
} from "./template-filler-model";

type TemplateField = {
  field_id: string;
  label: string;
  requirement: string;
  column: string;
  is_dropdown: boolean;
  allowed_values: string[];
};

type PolicyRule = { action: "required" | "reminder" | "default" | "ignore"; value?: string; scope?: "parent" | "child" | "all" };
type Policy = { version: number; rules: Record<string, PolicyRule> };
type PolicyDrift = { kind: string; field_id: string };

type AnalyzeResponse = {
  template_id: string;
  original_filename: string;
  template: { market: string; category: string; language_tag: string; field_count: number; data_row: number };
  sku_rows: Array<{ row: number; sku: string }>;
  summary: { sku_count: number; required_fields: number; conditional_fields: number; dropdown_fields: number; policy_required: number };
  fields: TemplateField[];
  policy_status: string;
  policy_drift: PolicyDrift[];
  policy: Policy | null;
};

type Issue = {
  sku: string;
  row: number;
  field_id: string;
  label: string;
  severity: "error" | "warning" | "info";
  status: string;
  message: string;
  allowed_values: string[];
};

type FilledField = {
  sku: string;
  row: number;
  field_id: string;
  label: string;
  value: string | number;
  source: string;
};

type VariantGroup = {
  seed_sku: string;
  parent_sku: string;
  child_skus: string[];
  variation_theme: string;
  status: string;
  message: string;
  expected_children?: number;
  actual_children?: number;
  skipped_association_skus?: string[];
  collection_status?: string;
};

type FillResponse = {
  output_file: string;
  report_file: string;
  summary: {
    rows_processed: number;
    fields_filled: number;
    missing_required: number;
    conditional_attention: number;
    manual_attention: number;
    business_required: number;
    policy_required: number;
    variant_groups_blocked: number;
    dropdown_required: number;
    upload_ready: boolean;
  };
  filled_fields: FilledField[];
  issues: Issue[];
  policy_status: string;
  policy_drift: PolicyDrift[];
  policy: Policy | null;
  variant_summary?: { seed_rows: number; groups_expanded: number; groups_blocked: number; parents_added: number; children_added: number };
  variant_groups?: VariantGroup[];
};

const fileInput = document.querySelector<HTMLInputElement>("#template-file")!;
const fileLabel = document.querySelector<HTMLElement>("#file-label")!;
const analyzeButton = document.querySelector<HTMLButtonElement>("#analyze-button")!;
const fillButton = document.querySelector<HTMLButtonElement>("#fill-button")!;
const message = document.querySelector<HTMLElement>("#message")!;
const dropzone = document.querySelector<HTMLElement>("#dropzone")!;
const analysisPanel = document.querySelector<HTMLElement>("#analysis-panel")!;
const resultPanel = document.querySelector<HTMLElement>("#result-panel")!;
const issueFilter = document.querySelector<HTMLSelectElement>("#issue-filter")!;
const savePolicyButton = document.querySelector<HTMLButtonElement>("#save-policy-button")!;
const policyMessage = document.querySelector<HTMLElement>("#policy-message")!;
const expandVariants = document.querySelector<HTMLInputElement>("#expand-variants")!;

let templateId = "";
let issues: Issue[] = [];
let policyFields: TemplateField[] = [];
let currentPolicy: Policy | null = null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/template-filler${path}`, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function setBusy(button: HTMLButtonElement, busy: boolean, busyText: string, idleText: string) {
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

function metric(value: string | number, label: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "metric";
  const strong = document.createElement("strong");
  strong.textContent = String(value);
  const span = document.createElement("span");
  span.textContent = label;
  item.append(strong, span);
  return item;
}

function renderAnalysis(data: AnalyzeResponse) {
  const metrics = document.querySelector<HTMLElement>("#analysis-metrics")!;
  metrics.replaceChildren(
    metric(`${data.template.market} · ${data.template.category}`, "站点与类目"),
    metric(data.summary.sku_count, "SKU 数量"),
    metric(data.summary.required_fields, "严格必填字段"),
    metric(data.summary.dropdown_fields, "下拉字段"),
    metric(data.summary.policy_required, "策略运营必填"),
  );
  const skuList = document.querySelector<HTMLElement>("#sku-list")!;
  skuList.replaceChildren(...data.sku_rows.map(({ row, sku }) => {
    const chip = document.createElement("span");
    chip.className = "sku-chip";
    chip.textContent = `${sku} · Row ${row}`;
    return chip;
  }));
  policyFields = data.fields;
  currentPolicy = data.policy;
  renderPolicyEditor(data.policy_status, data.policy_drift);
  analysisPanel.classList.remove("hidden");
  resultPanel.classList.add("hidden");
  analysisPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPolicyEditor(status: string, drift: PolicyDrift[]) {
  const policyDescription = `${policyStatusLabel(status)}${currentPolicy ? ` · 版本 ${currentPolicy.version}` : ""}`;
  policyMessage.textContent = drift.length
    ? `${policyDescription}。检测到 ${drift.length} 项模板结构变化；已继续复用匹配规则，请核对。`
    : status === "unconfigured"
      ? `${policyDescription}。请为这个新类目设置规则；未保存前，填表报告将阻止上传。`
      : `${policyDescription}。规则会自动复用于相同平台、站点和类目。`;
  const tbody = document.querySelector<HTMLTableSectionElement>("#policy-rule-table")!;
  tbody.replaceChildren(...policyFields.map(field => {
    const row = document.createElement("tr");
    row.dataset.fieldId = field.field_id;
    const name = document.createElement("td");
    const label = document.createElement("strong");
    label.textContent = field.label || field.field_id;
    const code = document.createElement("code");
    code.textContent = field.field_id;
    name.append(label, document.createElement("br"), code);
    const actionCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "policy-select";
    const rule = currentPolicy?.rules[field.field_id];
    for (const [value, text] of [["ignore", "不处理"], ["required", "运营必填"], ["reminder", "仅提醒"], ["default", "默认填写"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.selected = (rule?.action ?? "ignore") === value;
      select.append(option);
    }
    const valueCell = document.createElement("td");
    const input = document.createElement("input");
    input.className = "policy-value";
    input.value = rule?.value ?? "";
    input.placeholder = "仅默认填写时使用";
    input.disabled = select.value !== "default";
    select.addEventListener("change", () => { input.disabled = select.value !== "default"; });
    actionCell.append(select);
    valueCell.append(input);
    const scopeCell = document.createElement("td");
    const scope = document.createElement("select");
    scope.className = "policy-scope";
    for (const [value, text] of [["child", "仅子体"], ["parent", "仅父体"], ["all", "父体与子体"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.selected = (rule?.scope ?? "child") === value;
      scope.append(option);
    }
    scopeCell.append(scope);
    const allowed = document.createElement("td");
    allowed.textContent = field.allowed_values.length ? field.allowed_values.slice(0, 10).join(" / ") : "—";
    row.append(name, actionCell, scopeCell, valueCell, allowed);
    return row;
  }));
}

async function savePolicy() {
  if (!templateId) return;
  const rules: Array<{ field_id: string; action: string; scope: string; value?: string }> = [];
  document.querySelectorAll<HTMLTableRowElement>("#policy-rule-table tr").forEach(row => {
    const select = row.querySelector<HTMLSelectElement>(".policy-select")!;
    const input = row.querySelector<HTMLInputElement>(".policy-value")!;
    const scope = row.querySelector<HTMLSelectElement>(".policy-scope")!;
    if (select.value !== "ignore") {
      rules.push({ field_id: row.dataset.fieldId!, action: select.value, scope: scope.value, ...(select.value === "default" ? { value: input.value.trim() } : {}) });
    }
  });
  setBusy(savePolicyButton, true, "正在保存策略…", "保存当前类目策略");
  try {
    const data = await api<{ policy: Policy; policy_status: string; policy_drift: PolicyDrift[] }>(`/policies/${templateId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }),
    });
    currentPolicy = data.policy;
    renderPolicyEditor(data.policy_status, data.policy_drift);
    message.textContent = "模板画像策略已保存；后续同类模板会自动复用。";
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "策略保存失败";
  } finally {
    setBusy(savePolicyButton, false, "正在保存策略…", "保存当前类目策略");
  }
}

function renderIssues(filter: string) {
  const tbody = document.querySelector<HTMLTableSectionElement>("#issue-table")!;
  const visible = issues.filter(issue => filter === "all" || issue.severity === filter);
  if (!visible.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "当前筛选条件下没有问题。";
    row.append(cell);
    tbody.replaceChildren(row);
    return;
  }
  tbody.replaceChildren(...visible.map(issue => {
    const row = document.createElement("tr");
    const sku = document.createElement("td");
    sku.textContent = issue.sku;
    const field = document.createElement("td");
    const label = document.createElement("strong");
    label.textContent = issue.label || issue.field_id;
    const code = document.createElement("code");
    code.textContent = issue.field_id;
    field.append(label, document.createElement("br"), code);
    const status = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = `issue-tag ${issue.severity}`;
    tag.textContent = issueStatusLabel(issue.status);
    status.append(tag);
    const detail = document.createElement("td");
    detail.textContent = issue.message;
    if (issue.allowed_values?.length) {
      const allowed = document.createElement("div");
      allowed.className = "allowed";
      allowed.textContent = `允许值：${issue.allowed_values.slice(0, 12).join(" / ")}${issue.allowed_values.length > 12 ? " …" : ""}`;
      detail.append(allowed);
    }
    row.append(sku, field, status, detail);
    return row;
  }));
}

function renderFilledFields(filledFields: FilledField[]) {
  const tbody = document.querySelector<HTMLTableSectionElement>("#filled-table")!;
  if (!filledFields.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "本次没有新增填写字段。";
    row.append(cell);
    tbody.replaceChildren(row);
    return;
  }
  tbody.replaceChildren(...filledFields.map(item => {
    const row = document.createElement("tr");
    const sku = document.createElement("td");
    sku.textContent = item.sku;
    const field = document.createElement("td");
    const label = document.createElement("strong");
    label.textContent = item.label || item.field_id;
    const code = document.createElement("code");
    code.textContent = item.field_id;
    field.append(label, document.createElement("br"), code);
    const value = document.createElement("td");
    value.textContent = String(item.value);
    const source = document.createElement("td");
    source.textContent = filledSourceLabel(item.source);
    row.append(sku, field, value, source);
    return row;
  }));
}

function renderVariantGroups(groups: VariantGroup[]) {
  const tbody = document.querySelector<HTMLTableSectionElement>("#variant-group-table")!;
  if (!groups.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "本次按单 SKU 模式处理，未展开 Listing 变体。";
    row.append(cell);
    tbody.replaceChildren(row);
    return;
  }
  tbody.replaceChildren(...groups.map(group => {
    const row = document.createElement("tr");
    const groupStatus = variantGroupResultLabel(group);
    for (const value of [group.seed_sku, group.parent_sku || "—", group.child_skus.join(" / ") || "—", group.variation_theme || "—", groupStatus]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));
}

function renderResult(data: FillResponse) {
  issues = data.issues;
  const variantSummary = normalizeVariantSummary(data.variant_summary);
  const variantGroups = Array.isArray(data.variant_groups) ? data.variant_groups : [];
  const metrics = document.querySelector<HTMLElement>("#result-metrics")!;
  metrics.replaceChildren(
    metric(data.summary.fields_filled, "自动填写字段"),
    metric(data.summary.missing_required, "缺少严格必填"),
    metric(data.summary.dropdown_required, "下拉待选择"),
    metric(data.summary.manual_attention, "人工待确认"),
    metric(data.summary.business_required, "运营必填待补充"),
    metric(variantSummary.children_added, "新增子体行"),
    metric(variantSummary.groups_blocked, "阻断变体组"),
  );
  const badge = document.querySelector<HTMLElement>("#ready-badge")!;
  badge.textContent = uploadReadinessLabel(data.summary.upload_ready);
  badge.className = `status-pill ${data.summary.upload_ready ? "success" : ""}`;
  const workbook = document.querySelector<HTMLAnchorElement>("#workbook-download")!;
  workbook.href = `/api/downloads/${encodeURIComponent(data.output_file)}`;
  workbook.download = data.output_file;
  const report = document.querySelector<HTMLAnchorElement>("#report-download")!;
  report.href = `/api/template-filler/reports/${encodeURIComponent(data.report_file)}`;
  report.download = data.report_file;
  renderFilledFields(data.filled_fields);
  renderVariantGroups(variantGroups);
  issueFilter.value = "all";
  renderIssues("all");
  resultPanel.classList.remove("hidden");
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectFile(file?: File) {
  fileLabel.textContent = file?.name || "选择或拖入 XLSX / XLSM";
  analyzeButton.disabled = !file || !isSupportedTemplateFile(file.name);
  message.textContent = file && !isSupportedTemplateFile(file.name) ? "请选择 .xlsx 或 .xlsm 模板" : "";
}

fileInput.addEventListener("change", () => selectFile(fileInput.files?.[0]));

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", event => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  selectFile(file);
});

analyzeButton.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setBusy(analyzeButton, true, "正在解析模板…", "分析模板结构");
  message.textContent = "";
  const form = new FormData();
  form.append("file", file);
  try {
    const data = await api<AnalyzeResponse>("/analyze", { method: "POST", body: form });
    templateId = data.template_id;
    renderAnalysis(data);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "模板解析失败";
  } finally {
    setBusy(analyzeButton, false, "正在解析模板…", "重新分析模板");
  }
});

fillButton.addEventListener("click", async () => {
  if (!templateId) return;
  setBusy(fillButton, true, "正在抓取 GIGA 数据并填表…", "抓取 GIGA 数据并填表");
  message.textContent = "";
  try {
    const data = await api<FillResponse>("/fill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId, expand_variants: expandVariants.checked }),
    });
    renderResult(data);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "模板填表失败";
  } finally {
    setBusy(fillButton, false, "正在抓取 GIGA 数据并填表…", "重新抓取并填表");
  }
});

issueFilter.addEventListener("change", () => renderIssues(issueFilter.value));
savePolicyButton.addEventListener("click", () => { void savePolicy(); });
