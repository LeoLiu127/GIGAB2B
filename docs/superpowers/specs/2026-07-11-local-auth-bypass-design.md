# Local authentication bypass

## Goal

Remove the login interruption while the product workflow is still under active development. The application must load its main workspace and allow API requests without a password.

## Chosen approach

Keep the existing authentication routes and session-based implementation, but make authentication disabled by default through an explicit `AUTH_ENABLED` module-level setting. Its default value is `False`.

When disabled:

- The request guard lets every request through.
- `GET /api/auth/status` reports `required: false` and `authenticated: true`.
- The frontend follows its existing authenticated branch and never renders the login form.
- The application does not generate or print a temporary password.

## Recovery path

No authentication code is removed. Re-enabling it later is a single configuration change to the module setting and restores the existing password/session behavior.

## Tests

Add a backend regression test that imports the application under its default configuration and verifies that an anonymous request to a normally protected API succeeds. Preserve the existing tests that explicitly enable a password, so the retained authentication behavior stays covered.

## Scope limits

This change does not alter GIGA credentials, AI-provider configuration, API authorization rules unrelated to login, or the visual design of the main workspace.
