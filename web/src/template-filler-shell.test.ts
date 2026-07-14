/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import html from "../template-filler.html?raw";

describe("template filler shell", () => {
  it("uses the shared workbench layout and theme controls", () => {
    expect(html).toContain('data-page="template-filler"');
    expect(html).toContain('id="theme-control"');
    expect(html).toContain('href="/"');
    expect(html).toContain('class="template-workbench"');
    expect(html).toContain('class="template-sidebar"');
    expect(html).toContain('class="template-center"');
    expect(html).toContain('class="template-results"');
  });

  it("preserves every controller hook required by the existing workflow", () => {
    for (const id of [
      "template-file",
      "file-label",
      "dropzone",
      "analyze-button",
      "message",
      "analysis-panel",
      "analysis-metrics",
      "sku-list",
      "policy-message",
      "save-policy-button",
      "policy-rule-table",
      "expand-variants",
      "fill-button",
      "result-panel",
      "result-metrics",
      "workbook-download",
      "report-download",
      "variant-group-table",
      "filled-table",
      "issue-filter",
      "issue-table",
      "ready-badge",
    ]) {
      expect(html.match(new RegExp(`id=["']${id}["']`, "g"))).toHaveLength(1);
    }
  });
});
