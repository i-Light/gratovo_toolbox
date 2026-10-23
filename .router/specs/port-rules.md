# Rules for every 3e-3 port task

Read first: `CLAUDE.md`, `docs/conventions.md`, `.router/PLAN.md` (D1 to D5 for the bridge), `services/pipeline/README.md`. Look at one 3e-1 module and its test for the house style (`services/pipeline/src/gratovo_pipeline/run_control.py`, `tests/test_parallel.py`), and at `gemini/errors.py` and `gemini/progress.py` (already ported).

Bash commands start with `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$HOME/.local/bin:$PATH";` and run from `services/pipeline`.

1. **Port, don't rewrite.** Keep the old behaviour, names, comments that explain why, and the wire shapes. Change only what these rules or your spec say. `legacy/` is read-only: read it, never edit it.
2. **Imports:** `gratovo_bridge`/`gemini_bridge.X` → `gratovo_pipeline.gemini.X`; `comms.X` → `gratovo_pipeline.comms.X`; `gratovo.store` → `gratovo_pipeline.store`. Errors come from `gratovo_pipeline.gemini.errors` (every error class lives there now, including `ActionParseFailed`, `ActionRefused`, `SkillFileMissing`, `SkillInvalid`, `SkillVerifyFailed`; don't define new error classes elsewhere: if one is missing, stop and report).
3. **Typing:** pyright strict, Python 3.14 syntax (`X | None`, `list[str]`, `type` aliases). JSON-ish payloads are `dict[str, Any]`. Narrow `object` with `isinstance`. Use `# pyright: ignore[rule]` only where a library is untyped, with the rule named.
4. **No file paths from the old repository layout.** No `REPO / "data"`, no `Path(__file__).parents[2]`, no `%LOCALAPPDATA%\gratovo`, no `E:\...` defaults. Paths come in as parameters (from argv in the daemon, plan D2, D3).
5. **Tests:** port each old test file to `services/pipeline/tests/` with the same test names where they still make sense, typed. Port the test first and see it fail (import error is fine) before porting the module. No network: the autouse guard refuses every socket; a test that needs the fake extension on 127.0.0.1 asks for the `loopback` fixture (`tests/conftest.py`). Skip-marks in the old tests that skip on non-Windows: keep them (the app is Windows only; CI runs Windows). Never invent example data outside the AI niche (creators who cover AI tools; brands that sponsor them).
6. **Checks you must run and pass before reporting:** `uv run pytest -q`, `uv run pyright`, `uv run ruff check src tests`, `uv run ruff format --check src tests` (run `uv run ruff format` on your files first). All of the repository's Python tests, not only yours.
7. **Edit only your listed files.** If something outside them must change, stop and report it. Don't commit: the lead commits.
8. **Report in at most 15 lines:** pass or fail of each check, files changed, every deviation from the old code and why, open issues.
