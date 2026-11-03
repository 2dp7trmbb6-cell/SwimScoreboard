# Swim Scoreboard

A local, dependency-free Python 3.10+ web app for OBS. Uses SwimDataManager API v1 to display the active session's event, heat, roster, teams, and live race clock. Navy, cyan, and teal broadcast styling.

## Start

1. Start SwimDataManager (`python server.py` in its checkout), import a HY-TEK meet program, and select CTS serial or simulation there.
2. In this checkout run `python server.py`.
3. Open `http://127.0.0.1:8780` in your browser for controls.

For a manager on another trusted LAN computer: `python server.py --manager-url http://MANAGER_LAN_IP:8770`. The scoreboard server fetches the manager API; browser CORS settings are unnecessary. It polls every 400 ms and registers consumer `swim-scoreboard`. Only one scoreboard server per manager is recommended. Settings persist in ignored `data/settings.json`. No frontend build or npm installation is needed.

## OBS

Add a **Browser Source**, width **1920**, height **1080**, using one of:

- Traditional scoreboard: `http://127.0.0.1:8780/overlay?format=board`
- Transparent pool lane cards: `http://127.0.0.1:8780/overlay?format=lanes`

Use the URLs shown in the control dashboard. OBS and the scoreboard normally run on the same computer. Source background is transparent, with opaque translucent cards for readability; preview checkerboard is not in the output. Keep OBS Browser Source background transparent and reset source transforms before alignment. If OBS is on another trusted LAN machine, bind with `--host 0.0.0.0`, allow private firewall port 8780 and use the scoreboard computer's LAN IP. Controls remain local-only. This is a trusted-LAN application without authentication; do not publish its port to the Internet.

Under **Choose what goes on air**, select **Traditional scoreboard** or **Lane overlay**, then configure lane number, first/last name, team, seed, split, final time, and heat placement independently. Existing shared selections migrate to the traditional scoreboard; lane overlays start with lane/name/team only, plus placement on finish popups. The compact traditional header leads with a larger meet title, with event/heat and race description underneath. It no longer includes “In the water”. The preview-format selector also selects that format's field controls, but explicit OBS source URLs keep their format. Show output controls both formats.

**Show lane finish popups until next heat** is enabled by default. A lane's final time brings its card back while unfinished lanes stay hidden during the race. Placement appears in the large left-hand number position, replacing the lane number on finished cards. The right-side PLACE label is removed. If placement is unknown, the number position shows — and the popup says **FINISHED**. Disable Heat placement for lane overlays to hide that number entirely. Final time is included only if enabled for the lane overlay. A popup stays until session, event, or heat changes, including after the race clock stops or manager data becomes stale. Held results keep their manual/simulation labels. Show output can hide them at any time; disable finish popups to restore normal lane-card behavior. OBS browser refresh clears the local hold, which is rebuilt from current manager results when available. Physical CTS lane results still require a verified adapter or manual entry.

Popups use heat placement, not rankings across multiple heats. Manager placement can be explicitly entered for a finished lane or calculated once every occupied lane has a final time. Incomplete results never imply first place. A subtle fade plays once when a lane finishes; corrections update the card without replaying the entrance.

The **Traditional scoreboard width (pixels)** control under Output controls accepts 640–1760 pixels (default 1760). It changes the board's width within the existing 1920×1080 OBS canvas; the card remains anchored at x=80, y=80, and OBS source dimensions stay unchanged. Text, table columns, spacing, and the header adapt to the width. For the cleanest narrow broadcast layout, hide unneeded columns using the traditional scoreboard's field settings. Width changes do not affect lane overlay alignment.

For pool alignment, enable **Alignment mode** in the dashboard. Every enabled lane gets a labeled placeholder in the lane OBS source, even without an active meet. This overrides normal visibility and automatic hiding for lane output. **Exit alignment before broadcast**; the traditional scoreboard is unaffected.

1. Optionally choose a screenshot of your OBS scene as a reference image. It is local to the editor, never saved/uploaded or included in the output. A 1920×1080 image maps directly onto the OBS canvas.
2. Enable **Use pool geometry**, select the pool lane count (1–8), and adjust **Whole pool**. Drag its four handles in perimeter order: start / side A, finish / side A, finish / side B, start / side B. Use **Reverse lane order** if lane 1 is on side B. The geometry represents the complete pool including off-screen corners; it divides the width into equal physical lanes and projects them using a homography. Leave disabled lanes in their physical lane slots, rather than reducing the count to only visible lanes.
3. Set card start and length as percentages of pool length, and card height as a percentage of each lane. Perspective automatically adjusts spacing and size across the pool.
4. Select **Individual lane** (or click its polygon), then drag that card's corners for fine adjustment. Pixel offsets stay attached when the pool geometry moves. **Reset lane adjustment** removes only that lane's offsets.
5. For quicker movement, select a corner or all four corners, choose a 1/10/50 pixel step, then click/hold the direction pad. Arrow keys while the canvas is focused nudge the selection; Shift moves 10× faster. Numeric coordinates remain available. **Fit all corners** exposes off-screen handles; **1920 × 1080 view** returns to the OBS frame.

Coordinates may range from −10000 to 10000. Invalid/crossing quadrilaterals are rejected; the save status reports any server-side failure. Existing saved manual alignment remains unchanged until you opt into pool geometry. Disable unused lane cards with Include lane; only lanes within the selected pool count are shown in pool mode. Settings persist on the scoreboard server; the temporary reference image does not. Reset OBS source transforms before alignment, and recalibrate after moving the camera or altering scene transforms.

Automatic hiding latches for lane cards once a fresh, connected clock exceeds 0.5 seconds. Unfinished lanes stay hidden if the clock stops or becomes stale, while finish popups remain visible. Advancing the session/event/heat resets that state. For a re-swim of the same heat, turn automatic hiding off to show the pre-race cards manually. No explicit race-start signal exists in the current API. Simulation and disconnections are labeled; race clocks are withheld when stale.

## Timing availability and optional API extension

**Legacy SwimDataManager versions do not expose seed, split, or lane final times.** These fields display `—` until the manager supplies them; the scoreboard never fabricates them. The companion manager update adds seed imports, local lane-result entry/API, and simulated results. Physical CTS lane decoding still requires a verified protocol mapping. Relay entries display only the relay team name and A/B designation, when provided, in both layouts; leg swimmer names are omitted. The traditional table labels the entry column RELAY TEAM and omits a duplicate team column. The lane card also omits the duplicate team subtitle.

The scoreboard can consume this optional API extension: swimmer `seedTime` as a display string; `feed.results` scoped to current event/heat:

```json
{"event":3,"heat":2,"lanes":{"2":{"splits":["0:28.31","0:58.42"],"finalTime":"0:58.42"}}}
```

Results are displayed only while manager polling is fresh and event/heat match. A supplied session ID must match the active session. Results can remain visible after the race clock stops; manually entered results carry a visible label. Session changes must clear manager results. Names accept either `Last, First` or `First Last`; compound names without commas use the final word as the last name. Validate physical CTS timing and race transitions at the venue before broadcast use.

## Validation

- `python -m unittest -v`: configuration validation/persistence, HTTP controls and origin checks, real sibling SwimDataManager integration, simulation, heartbeat, source stop, and outage. Integration test requires sibling `../SwimDataManager`.
- `node test_render.cjs`: roster escaping, field selection, stale clocks, heat changes, visibility, and perspective matrix. Uses only Node built-ins.
- Optional `node test_browser.cjs`: requires Playwright and Chromium, a scoreboard server on port 8780 connected to a simulated meet with lane 2 `Smith, Jamie` and a clock beyond 0.5 seconds. Uses temporary/test settings only: this test changes visibility and field selections. For a disposable full integration run, use `python browser_smoke.py` with the sibling manager checkout and Playwright installed. It starts isolated temporary servers and data, and automatically uses `/usr/bin/chromium` if available; set `CHROMIUM_PATH` to select another installed browser. Browser checks cover transparent output, live settings, pool handles, nudging, lane count, and alignment mode.

Physical serial/OBS capture and camera alignment require venue acceptance testing.


If seed times show —, check the seed status under swimmer details, enable **Seed time**, and use **Update report** in the manager to re-import sessions saved before seed support. Restart the updated manager first. Manager session counts distinguish timed seeds, NT, and missing values. An older stored program cannot reconstruct seed values discarded during its original import.


## OBS live updates and troubleshooting

Use a **Browser Source** with **Local file unchecked**. Traditional output is `/overlay?format=board`; pool perspective and lane alignment affect `/overlay?format=lanes` only. Both URLs must point to the same scoreboard server you control in the dashboard. If OBS is on another computer, `127.0.0.1` points to that computer, so use the scoreboard server's LAN address instead.

After pulling an update, restart the scoreboard server and click **Refresh cache of current page** once in OBS source properties. Existing sources loaded before automatic version checks need that initial refresh. New output pages reload themselves when a later server build changes. Live data/settings requests bypass caching and time out after 2.5 seconds, then retry; an unresolved request no longer blocks all subsequent polls. Rendering errors display their actual reason instead of being mislabeled as a disconnected server. Array `.at` and `Object.hasOwn` dependencies were removed for older embedded browser engines; very old OBS releases that lack optional-chaining support still require upgrading OBS.

The dashboard's OBS section shows the most recent sync time, server host, and settings revision. Temporarily append `&debug=1` to the OBS output URL to display the same revision/time there. They should track the dashboard after a save. Remove that parameter before going on air. A changing sync time with “Manager offline” means the source is connected to the scoreboard but its manager connection needs attention. Idle dashboard tabs also pick up configuration saved by another controller; unsaved/in-progress edits are preserved.

`SMOKE_SCRIPT=test_obs_sync.cjs python browser_smoke.py` (shell syntax shown for macOS/Linux) runs disposable browser checks for meet/report changes in already-open outputs, corner-angle changes, multiple controllers, older-engine feature compatibility, stalled-request recovery, and app-version reloads. No live meet data is used.
