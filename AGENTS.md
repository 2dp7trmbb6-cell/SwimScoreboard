# SwimScoreboard development

- Work in this existing checkout; each cloud task is already isolated. Do not create a worktree unless requested.
- Runtime: Python 3.10+ standard library; Node for renderer tests. No frontend build or npm install is needed.
- `server.py` serves `static/`, polls the manager and validates/persists configuration. `static/app.js` contains dashboard controls, renderer, phase tracking and alignment; `static/style.css` styles both controls and OBS output.
- Start the sibling `/workspace/SwimDataManager` using `.venv/bin/python server.py` from its checkout, then `python server.py` here. Default ports are 8770 and 8780, loopback only. Keep existing meet data/settings in ignored `data/`; use disposable smoke tests for mutations.
- If the sibling manager is absent, the documented companion is `https://github.com/2dp7trmbb6-cell/SwimDataManager.git`. It needs `pyserial==3.5` from its requirements.txt for physical serial support. Simulation needs no hardware or credentials.
- Required checks: `python -m unittest -v`, `node test_render.cjs`, `node test_phases.cjs`. The Python integration test requires the sibling manager; report skips explicitly. Socket permission failures are execution restrictions, not application bugs.
- Browser checks: `python browser_smoke.py`; feature-specific runs use `SMOKE_SCRIPT=test_personal_best_browser.cjs python browser_smoke.py` (or other documented scripts). Requires Node Playwright and Chromium; set CHROMIUM_PATH if needed. Fixtures, servers and settings are disposable. Browser smoke runners mutate their test settings.
- Readiness: manager `/api/v1/state` has version 1; scoreboard `/api/state` has error null and state.version 1. Test dashboard and all three overlay formats. Do not expose these unauthenticated services publicly.
- Add settings to defaults, backward-compatible migration, strict validation, UI controls and tests together. Preserve independent start/split/finish fields and heat/session/source reset rules. Never fabricate unavailable timing, placement or personal records.
- Physical CTS/OBS/camera alignment requires separate venue acceptance testing.
