import "./template-filler.css";
import { isSupportedTemplateFile, issueStatusLabel, uploadReadinessLabel } from "./template-filler-model";

type AnalyzeResponse = {
  template_id: string;
  original_filename: string;
  template: { market: string; category: string; language_tag: string; field_count: number; data_row: number };
  sku_rows: Array<{ row: number; sku: string }>;
  summary: { sku_count: number; required_fields: number; conditional_fields: number; dropdown_fields: number };
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

type FillResponse = {
  output_file: string;
  report_file: string;
  summary: {
    rows_processed: number;
    fields_filled: number;
    missing_required: number;
    conditional_attention: number;
    dropdown_required: number;
    upload_ready: boolean;
  };
  issues: Issue[];
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

let templateId = "";
let issues: Issue[] = [];

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
  );
  const skuList = document.querySelector<HTMLElement>("#sku-list")!;
  skuList.replaceChildren(...data.sku_rows.map(({ row, sku }) => {
    const chip = document.createElement("span");
    chip.className = "sku-chip";
    chip.textContent = `${sku} · Row ${row}`;
    return chip;
  }));
  analysisPanel.classList.remove("hidden");
  resultPanel.classList.add("hidden");
  analysisPanel.scrollIntoView({ behavior: "smooth", block: "start" });
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

function renderResult(data: FillResponse) {
  issues = data.issues;
  const metrics = document.querySelector<HTMLElement>("#result-metrics")!;
  metrics.replaceChildren(
    metric(data.summary.fields_filled, "自动填写字段"),
    metric(data.summary.missing_required, "缺少严格必填"),
    metric(data.summary.dropdown_required, "下拉待选择"),
    metric(data.summary.conditional_attention, "条件必填待确认"),
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
      body: JSON.stringify({ template_id: templateId }),
    });
    renderResult(data);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "模板填表失败";
  } finally {
    setBusy(fillButton, false, "正在抓取 GIGA 数据并填表…", "重新抓取并填表");
  }
});

issueFilter.addEventListener("change", () => renderIssues(issueFilter.value));
