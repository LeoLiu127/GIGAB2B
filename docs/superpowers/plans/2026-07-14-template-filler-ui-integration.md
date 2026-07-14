# Template Filler UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Integrate the Amazon template filler into the existing GIGAB2B visual system with a lightweight main-workbench entry, a separate three-column template page, and synchronized light, saddle, and midnight themes.

**Architecture:** Keep / and /template-filler.html as separate Vite entry points and keep all template business calls under /api/template-filler/*. Reuse web/src/theme.ts as the only theme-token and local-storage source, add a small module link to the main header, and restyle the template page without changing its API contracts or backend code.

**Tech Stack:** React 19, TypeScript 5.5, Vite 6, Vitest 4, static HTML/CSS for the template page, existing Flask backend.

## Global Constraints

- Work only in F:\AI Projects\GIGAB2B\.runtime\worktrees\amazon-template-filler-mvp on codex/amazon-template-filler-mvp.
- Do not touch the dirty main worktree at F:\AI Projects\GIGAB2B.
- Keep / and /template-filler.html as separate pages on the same origin.
- Do not change /api/template-filler/*, GIGA fetching, XLSM writing, policy storage, or download contracts.
- Preserve the existing light, saddle, and midnight tokens and gigab2b-theme storage key.
- Keep existing template DOM IDs used by template-filler.ts.
- Do not add frontend dependencies.

---

### Task 1: Shared theme application and main-workbench entry

**Files:**
- Modify: web/src/theme.test.ts
- Modify: web/src/theme.ts
- Modify: web/src/App.tsx
- Modify: web/src/components/Header.tsx
- Modify: web/src/index.css

**Interfaces:**
- Consumes: ThemeId, THEME_TOKENS, and writeStoredTheme from web/src/theme.ts.
- Produces: applyThemeToDocument(theme, root?, storage?) and a main-header link to /template-filler.html.

- [ ] **Step 1: Add a failing shared-theme test**

~~~ts
it("applies tokens and persists a selected theme", () => {
  const tokens: Record<string, string> = {};
  const root = {
    dataset: {} as Record<string, string>,
    style: { setProperty: (name: string, value: string) => { tokens[name] = value; } },
  };
  const stored: Record<string, string> = {};
  applyThemeToDocument("midnight", root, {
    setItem: (key: string, value: string) => { stored[key] = value; },
  });
  expect(root.dataset.theme).toBe("midnight");
  expect(tokens["--theme-action-bg"]).toBe("#2563eb");
  expect(stored[THEME_STORAGE_KEY]).toBe("midnight");
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm test -- --run src/theme.test.ts

Expected: FAIL because applyThemeToDocument is not exported.

- [ ] **Step 3: Implement the shared helper**

~~~ts
export type ThemeRoot = {
  dataset: Record<string, string>;
  style: { setProperty(name: string, value: string): void };
};

export function applyThemeToDocument(
  theme: ThemeId,
  root: ThemeRoot = document.documentElement,
  storage?: Pick<Storage, "setItem">,
): void {
  root.dataset.theme = theme;
  Object.entries(THEME_TOKENS[theme]).forEach(([name, value]) => root.style.setProperty(name, value));
  writeStoredTheme(theme, storage);
}
~~~

Replace the inline token loop in App.tsx with applyThemeToDocument(theme).

- [ ] **Step 4: Add the isolated module entry**

Render this in Header.tsx and style it with existing theme variables:

~~~tsx
<a className="module-link" href="/template-filler.html">Amazon 模板填表</a>
~~~

Do not alter the main workbench grid or business state.

- [ ] **Step 5: Verify GREEN**

Run: npm test -- --run src/theme.test.ts

Expected: PASS.

Run: npm run build

Expected: dist/index.html and dist/template-filler.html are both emitted.

- [ ] **Step 6: Commit**

~~~powershell
git add -- web/src/theme.test.ts web/src/theme.ts web/src/App.tsx web/src/components/Header.tsx web/src/index.css
git commit -m "feat: share theme behavior with template filler"
~~~

### Task 2: Three-column template shell with preserved behavior hooks

**Files:**
- Create: web/src/template-filler-shell.test.ts
- Modify: web/template-filler.html
- Modify: web/src/template-filler.css

**Interfaces:**
- Consumes: all current DOM IDs queried by web/src/template-filler.ts.
- Produces: header, left workflow rail, center analysis/policy workspace, right result rail, theme controls, and module navigation.

- [ ] **Step 1: Add a failing shell-contract test**

The test reads the HTML and CSS and requires:

~~~ts
expect(html).toContain('data-page="template-filler"');
expect(html).toContain('id="theme-control"');
expect(html).toContain('href="/"');
expect(html).toContain('class="template-workbench"');
expect(html).toContain('class="template-sidebar"');
expect(html).toContain('class="template-center"');
expect(html).toContain('class="template-results"');
expect(css).toContain("var(--theme-page-bg)");
expect(css).toContain('html[data-theme="midnight"]');
~~~

It must also assert that template-file, analyze-button, analysis-panel, policy-rule-table, expand-variants, fill-button, result-panel, variant-group-table, filled-table, and issue-table each remain present.

- [ ] **Step 2: Verify RED**

Run: npm test -- --run src/template-filler-shell.test.ts

Expected: FAIL because the workbench shell and theme controls do not exist.

- [ ] **Step 3: Replace the marketing layout**

Rewrite web/template-filler.html so the header matches the existing brand, the left rail owns upload and actions, the center owns analysis and policies, and the right rail owns variant results, issues, and downloads. Preserve every functional ID exactly once.

- [ ] **Step 4: Implement token-driven CSS**

Rewrite web/src/template-filler.css using only existing theme variables for colors. Match the main 77px header, thin dividers, 4px radii, compact 12–14px typography, and three-column density. Keep center and right regions independently scrollable on desktop and collapse below 980px.

- [ ] **Step 5: Verify GREEN**

Run: npm test -- --run src/template-filler-shell.test.ts

Expected: PASS.

Run: npm run build

Expected: PASS with both HTML entries.

- [ ] **Step 6: Commit**

~~~powershell
git add -- web/src/template-filler-shell.test.ts web/template-filler.html web/src/template-filler.css
git commit -m "feat: align template filler with workbench UI"
~~~

### Task 3: Template theme controls, status display, and progress states

**Files:**
- Modify: web/src/template-filler-model.test.ts
- Modify: web/src/template-filler-model.ts
- Modify: web/src/template-filler.ts

**Interfaces:**
- Consumes: readStoredTheme, applyThemeToDocument, THEME_PICKER_OPTIONS, optional GET /api/server-status, and current template APIs.
- Produces: synchronized theme controls, non-blocking status chips, and deterministic four-step progress rendering.

- [ ] **Step 1: Add failing pure-model tests**

~~~ts
expect(templateProgressState("idle")).toEqual(["active", "pending", "pending", "pending"]);
expect(templateProgressState("analyzed")).toEqual(["complete", "complete", "active", "pending"]);
expect(templateProgressState("filled")).toEqual(["complete", "complete", "complete", "active"]);
expect(serverStatusLabels(null)).toEqual([
  { label: "文案优化大模型", ok: false },
  { label: "生图大模型", ok: false },
  { label: "GIGAB2B API", ok: false },
]);
~~~

- [ ] **Step 2: Verify RED**

Run: npm test -- --run src/template-filler-model.test.ts

Expected: FAIL because templateProgressState and serverStatusLabels do not exist.

- [ ] **Step 3: Implement view-model helpers**

Export TemplateProgress, templateProgressState(progress), and serverStatusLabels(status). The status formatter must tolerate missing and malformed payloads.

- [ ] **Step 4: Bind controller behavior**

In template-filler.ts, initialize the stored theme, bind three theme buttons, fetch /api/server-status without blocking the workflow, and update progress before and after analyze/fill calls. Preserve all existing template API paths, bodies, rendering, downloads, and error messages.

- [ ] **Step 5: Verify GREEN**

Run: npm test -- --run src/template-filler-model.test.ts src/theme.test.ts src/template-filler-shell.test.ts

Expected: PASS.

Run: npm test -- --run

Expected: all frontend tests pass.

- [ ] **Step 6: Commit**

~~~powershell
git add -- web/src/template-filler-model.test.ts web/src/template-filler-model.ts web/src/template-filler.ts
git commit -m "feat: synchronize template filler themes and status"
~~~

### Task 4: Integration verification and visual QA

**Files:**
- Create: design-qa.md
- Modify only when QA finds P0/P1/P2 issues: the frontend files from Tasks 1–3.

**Interfaces:**
- Consumes: approved light, saddle, and midnight UI references and the local app.
- Produces: browser screenshots, interaction evidence, and a passing design-qa.md.

- [ ] **Step 1: Run full frontend verification**

Run: npm test -- --run

Expected: zero failures.

Run: npm run build

Expected: exit 0 with both HTML entries.

- [ ] **Step 2: Run backend template tests**

Run: python -m pytest tests/test_template_filler.py tests/test_template_filler_policy.py tests/test_template_filler_variants.py -q

Expected: zero failures. If pytest is unavailable, report the missing dependency explicitly and do not claim this gate passed.

- [ ] **Step 3: Run the shared services**

Use one Flask process on 5182 and one Vite process on the configured frontend port. Do not start another backend.

- [ ] **Step 4: Verify interactions**

For / and /template-filler.html, switch all three themes, follow both module links, verify theme persistence, analyze CABINET and CHAIR, run variant expansion and filling, filter issues, use both downloads, and check the browser console.

- [ ] **Step 5: Run design QA**

Capture the implementation at 1440 × 1024. Compare source and implementation together, fix every P0/P1/P2 issue, and write design-qa.md with final result: passed.

- [ ] **Step 6: Final diff and commit**

~~~powershell
git diff --check
git status --short
git add -- design-qa.md web
git commit -m "test: verify integrated template filler UI"
~~~

Expected: the feature worktree is clean and the main worktree remains untouched.
