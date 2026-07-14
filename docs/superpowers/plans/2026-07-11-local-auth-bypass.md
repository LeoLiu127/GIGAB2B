# Local Authentication Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the application without a login prompt while retaining the existing password authentication implementation for later re-enablement.

**Architecture:** Add an environment-derived `AUTH_ENABLED` flag in `app.py` that defaults to `False`. All authentication decisions use this flag: when disabled, no temporary password is created, the request guard allows calls, and the existing status endpoint reports an already authenticated session. The frontend needs no structural change because it already renders the workspace whenever `required` is false.

**Tech Stack:** Python 3.11, Flask 3, unittest, React 19, TypeScript, Vite 6.

## Global Constraints

- `AUTH_ENABLED` defaults to `False`.
- Existing authentication routes and session-based behavior remain available when `GIGAB2B_AUTH_ENABLED=1`.
- No change may affect GIGA credentials, AI-provider configuration, or the listing workflow.
- Tests use `python -m unittest`, and the frontend still passes `npm run test` and `npm run build`.

---

### Task 1: Make local authentication opt-in

**Files:**
- Modify: `tests/test_security_and_core.py:23-35,160-183`
- Modify: `app.py:46-99,1810-1839,2746-2749`

**Interfaces:**
- Consumes: `GIGAB2B_AUTH_ENABLED`, an optional environment variable whose value `1` enables password protection.
- Produces: module constant `AUTH_ENABLED: bool`; `/api/auth/status` returns `{"required": false, "authenticated": true}` by default.

- [ ] **Step 1: Write the failing test**

Remove the `ACCESS_PASSWORD` patch from `SecurityAndCoreTests.setUp` and add this test immediately before `test_api_requires_login_when_access_password_is_configured`:

```python
    def test_api_is_open_by_default_while_authentication_is_bypassed(self):
        status = self.client.get("/api/auth/status")
        markets = self.client.get("/api/markets")

        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.get_json(), {"required": False, "authenticated": True})
        self.assertEqual(markets.status_code, 200)
```

Update the two existing password-specific test contexts to patch both flags:

```python
with patch.object(app_module, "AUTH_ENABLED", True), patch.object(
    app_module, "ACCESS_PASSWORD", "correct-horse-battery-staple"
):
```

- [ ] **Step 2: Run the regression test to verify it fails**

Run: `python -m unittest tests.test_security_and_core.SecurityAndCoreTests.test_api_is_open_by_default_while_authentication_is_bypassed -v`

Expected: FAIL because the current app generates a temporary password and returns `401` for `/api/markets`.

- [ ] **Step 3: Implement the minimal authentication switch**

At the authentication configuration block in `app.py`, add `AUTH_ENABLED` and only create a password when it is enabled:

```python
AUTH_ENABLED = os.getenv("GIGAB2B_AUTH_ENABLED", "0").strip() == "1"
_configured_access_password = os.getenv("GIGAB2B_ACCESS_PASSWORD", "").strip()
ACCESS_PASSWORD_IS_TEMPORARY = AUTH_ENABLED and not bool(_configured_access_password)
ACCESS_PASSWORD = (
    _configured_access_password
    if AUTH_ENABLED
    else ""
)
if AUTH_ENABLED and not ACCESS_PASSWORD:
    ACCESS_PASSWORD = secrets.token_urlsafe(18)
```

Use `AUTH_ENABLED` in `_require_authentication`, `auth_status`, and `auth_login` so that disabled authentication always passes. Also guard the startup password print with `if AUTH_ENABLED and ACCESS_PASSWORD_IS_TEMPORARY:`.

- [ ] **Step 4: Run focused backend tests**

Run: `python -m unittest tests.test_security_and_core.SecurityAndCoreTests.test_api_is_open_by_default_while_authentication_is_bypassed tests.test_security_and_core.SecurityAndCoreTests.test_api_requires_login_when_access_password_is_configured tests.test_security_and_core.SecurityAndCoreTests.test_login_throttles_repeated_wrong_passwords -v`

Expected: all three tests PASS. The first proves the bypass; the latter two prove the retained opt-in authentication flow.

- [ ] **Step 5: Run the complete verification suite**

Run: `python -m unittest discover -s tests -v`, then `npm run test`, then `npm run build` in `web`.

Expected: every backend and frontend test passes, and the TypeScript/Vite production build exits with code 0.

- [ ] **Step 6: Review the final diff**

Run: `git diff -- app.py tests/test_security_and_core.py`.

Expected: only the opt-in authentication switch and its regression coverage appear; no unrelated workspace edits are staged or overwritten.
