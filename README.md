# Swim Scoreboard

A local, dependency-free Python 3.10+ web app for OBS. Uses SwimDataManager API v1 to display the active session's event, heat, roster, teams, and live race clock. Navy, cyan, and teal broadcast styling.

## Start

1. Start SwimDataManager (`python server.py` in its checkout), import a HY-TEK meet program, and select CTS serial or simulation there.
2. In this checkout run `python server.py`.
3. Open `http://127.0.0.1:8780` in your browser for controls.

For a manager on another trusted LAN computer: `python server.py --manager-url http://MANAGER_LAN_IP:8770`. The scoreboard server fetches the manager API; browser CORS settings are unnecessary. It polls every 400 ms and registers consumer `swim-scoreboard`. Only one scoreboard server per manager is recommended. Settings persist in ignored `data/settings.json`. No frontend build or npm installation is needed.

## OBS

Add a **Browser Source**, width **1920**, height **1080**, using one of:

- Condensed broadcast: `http://127.0.0.1:8780/overlay?format=compact`
- Traditional scoreboard: `http://127.0.0.1:8780/overlay?format=board`
- Transparent pool lane cards: `http://127.0.0.1:8780/overlay?format=lanes`

Use the URLs shown in the control dashboard. OBS and the scoreboard normally run on the same computer. Source background is transparent, with opaque translucent cards for readability; preview checkerboard is not in the output. Keep OBS Browser Source background transparent and reset source transforms before alignment. If OBS is on another trusted LAN machine, bind with `--host 0.0.0.0`, allow private firewall port 8780 and use the scoreboard computer's LAN IP. Controls remain local-only. This is a trusted-LAN application without authentication; do not publish its port to the Internet.

Under **Choose what goes on air**, select **Traditional scoreboard**, **Lane overlay**, or **Condensed broadcast**, then configure lane number, first/last name, team, seed, split, final time, and heat placement independently. Existing shared selections migrate to the traditional scoreboard; lane overlays start with lane/name/team only, plus placement on finish popups. The compact traditional header leads with a larger meet title, with event/heat and race description underneath. It no longer includes “In the water”. The preview-format selector also selects that format's field controls, but explicit OBS source URLs keep their format. Show output controls all formats. For lane overlays, select Start, Split received, or Finish in the state selector to configure each independently.

**Enable finish overlays** is enabled by default. A lane's final time brings its finish card back while other lanes follow their own start/split states. Placement appears in the large left-hand number position; missing placement shows — and FINISHED. Each phase has its own fields: start defaults to lane/name/team, split defaults to those fields plus latest split, and finish defaults to name/team/place/final time. Existing start selections and alignment are preserved during migration. Finish fields can optionally include the lane number as supplementary text; it never replaces the large placement number.

Finish timing defaults to immediate appearance and holding until session/event/heat advances. It can instead expire after a configured number of seconds. A stopped clock or temporary loss of manager results does not reset an observed finish window. Corrections update the value/place without restarting its timer. Show output can hide all states at any time. OBS source refresh restarts its locally observed timers; current manager values are observed again on reload. Updated managers provide observed System 6 serial results as well as replay/manual data; validate console configuration and race transitions before meet use. This change does not alter Data Manager decoding.

Popups use heat placement, not rankings across multiple heats. Manager placement can be explicitly entered for a finished lane or calculated once every occupied lane has a final time. Incomplete results never imply first place. A subtle fade plays once when a lane finishes; corrections update the card without replaying the entrance.

The **Traditional scoreboard width (pixels)** control under Output controls accepts 640–1760 pixels (default 1760). It changes the board's width within the existing 1920×1080 OBS canvas; the card remains anchored at x=80, y=80, and OBS source dimensions stay unchanged. Text, table columns, spacing, and the header adapt to the width. For the cleanest narrow broadcast layout, hide unneeded columns using the traditional scoreboard's field settings. Width changes do not affect lane overlay alignment.

The **Condensed broadcast** format is intended for tight pool-camera compositions. Its default layout puts a 1024-pixel-wide meet/event/clock banner at x=880, y=16 and a 624-pixel-wide lane roster at x=1280, 16 pixels above the bottom of the 1920×1080 video. Eight lanes at 32 pixels per row occupy about 280 pixels vertically, leaving the pool area between the panels transparent. It uses the navy/cyan/teal theme and does not add a full-frame background.

Choose Condensed broadcast in the preview selector and use its own display-field selection. Defaults are lane, abbreviated name (`LAST, F.`), team, latest split, and final time. Relay entries remain team-only. Under **Condensed broadcast**, toggle the header/results independently and turn name abbreviation off if desired. Expand **Panel positions and sizes** to set header left/top/width and results left/bottom margin/width/row height. Bounds are validated, settings persist, and live OBS pages update after saving. The existing traditional width and pool-alignment controls apply to their respective formats; condensed panels have their own controls. Missing times remain —.

Use a Browser Source URL ending in `format=compact`, with Local file off, width 1920 and height 1080. Drag/crop the source in OBS only after configuring the panel positions against your camera shot. To validate the compact footprint with a disposable eight-lane fixture, run `SMOKE_SCRIPT=test_compact_browser.cjs python browser_smoke.py` (macOS/Linux shell syntax); existing Browser Source tests still run with `python browser_smoke.py`.

For pool alignment, enable **Alignment mode** in the dashboard. Every enabled lane gets a labeled placeholder in the lane OBS source, even without an active meet. This overrides normal visibility and automatic hiding for lane output. **Exit alignment before broadcast**; the traditional scoreboard is unaffected.

1. Optionally choose a screenshot of your OBS scene as a reference image. It is local to the editor, never saved/uploaded or included in the output. A 1920×1080 image maps directly onto the OBS canvas.
2. Enable **Use pool geometry**, select the pool lane count (1–8), and adjust **Whole pool**. Drag its four handles in perimeter order: start / side A, finish / side A, finish / side B, start / side B. Use **Reverse lane order** if lane 1 is on side B. The geometry represents the complete pool including off-screen corners; it divides the width into equal physical lanes and projects them using a homography. Leave disabled lanes in their physical lane slots, rather than reducing the count to only visible lanes.
3. Set card start and length as percentages of pool length, and card height as a percentage of each lane. Perspective automatically adjusts spacing and size across the pool.
4. Select **Individual lane** (or click its polygon), then drag that card's corners for fine adjustment. Pixel offsets stay attached when the pool geometry moves. **Reset lane adjustment** removes only that lane's offsets.
5. For quicker movement, select a corner or all four corners, choose a 1/10/50 pixel step, then click/hold the direction pad. Arrow keys while the canvas is focused nudge the selection; Shift moves 10× faster. Numeric coordinates remain available. **Fit all corners** exposes off-screen handles; **1920 × 1080 view** returns to the OBS frame.

Coordinates may range from −10000 to 10000. Invalid/crossing quadrilaterals are rejected; the save status reports any server-side failure. Existing saved manual alignment remains unchanged until you opt into pool geometry. Disable unused lane cards with Include lane; only lanes within the selected pool count are shown in pool mode. Settings persist on the scoreboard server; the temporary reference image does not. Reset OBS source transforms before alignment, and recalibrate after moving the camera or altering scene transforms.

Start hiding is anchored to the first fresh, connected race-clock reading and the configurable hide-after-start grace (default 0.5 seconds). Once the race has started, stopping/staling the clock does not bring start cards back. Session/event/heat advance resets the phase state. For a re-swim in the same heat, turn automatic start hiding off to show cards manually. No explicit race-start signal exists in the current API. Simulation and disconnections are labeled; race clocks are withheld when stale.

## Timing availability and optional API extension

**Legacy SwimDataManager versions do not expose seed, split, or lane final times.** These fields display `—` until the manager supplies them; the scoreboard never fabricates them. The companion manager update adds seed imports, local lane-result entry/API, and simulated results. Updated managers support the captured System 6 scoreboard mapping; other configurations still require validation. Relay entries display only the relay team name and A/B designation, when provided, in both layouts; leg swimmer names are omitted. The traditional table labels the entry column RELAY TEAM and omits a duplicate team column. The lane card also omits the duplicate team subtitle.

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


### Reserved rows for unused lanes

Traditional and condensed tables reserve one row per lane. An unused lane keeps its slot and striping with every cell blank, including lane number and times. Rows use a consistent single-line height so sparse heats do not shrink the table; long traditional names are ellipsized with their full value in the browser tooltip. Lane overlays continue to show occupied lanes only.

Set **Pool lane count (reserves rows on both boards)** under Output controls to the physical pool size; this is shared with Pool alignment's lane count. Both tables also retain any higher lane numbers found anywhere in the active session, even when the current heat does not use them. Sessions containing lane 0 reserve its slot too. This keeps row positions stable as heats advance and also leaves a blank table while waiting for a matching heat. Condensed row height remains configurable in its panel settings.

`SMOKE_SCRIPT=test_fixed_rows_browser.cjs python browser_smoke.py` checks empty-cell content and equal panel/row heights before and after removing swimmers, using temporary data.


### Lane overlay phases and delays

Select **Lane overlay** under display fields, then choose **Start / pre-race**, **Split received**, or **Finish / final result**. Each selection has its own lane/name/team/seed/split/final/placement switches. Lane-overlay timing controls are separate from traditional/condensed fields.

| Control | Default | Meaning |
| --- | --- | --- |
| Start delay | 0 s | Wait after a matching heat first appears |
| Start duration | 0 | Hold until race starts; positive values set a maximum show time |
| Hide start after race clock reaches | 0.5 s | Grace after the race starts, when automatic hiding is enabled |
| Split delay | 0 s | Wait after a new cumulative split is observed for a lane |
| Split duration | 5 s | How long that split card stays visible |
| Finish delay | 0 s | Wait after the lane's final time is first observed |
| Finish duration | 0 | Hold until next session/event/heat; positive values expire the card |

Timings allow up to 600 seconds. Split duration must be positive. Each lane operates independently. A final suppresses the split/start states immediately, including while its finish appearance is delayed or after its display expires. Repeated polling of the same split/final does not restart a window; a new split count/value creates a new split window. Windows keep elapsing while Show output is off. Alignment mode still shows all enabled lane placeholders without timing requirements.

**Emphasize split/final time near the wide end** is enabled by default. The high-contrast primary time is inside the same perspective-transformed card as the name/team, directly beneath those details. It scales, rotates and moves with the card when any alignment corner changes; it is no longer a detached screen-space badge. **Time size before alignment** accepts 18–64 card pixels (default 36), capped as needed to fit the selected name/team fields within the card. Turn emphasis off to use the original right-side time text. The time field must be enabled in the selected phase. Existing saved emphasis settings continue to work.

Running clocks in the traditional, condensed, and control views now render tenths between manager polls using bounded interpolation. They resynchronize to each received CTS reading, freeze on repeated stopped readings, and reset/hide on a reset/stale clock. Extrapolation is capped at half a second; split/final values are never interpolated or changed.

Validation: `node test_phases.cjs` covers phase precedence, fields, delays, expiry, duplicate split suppression, heat reset, and clock interpolation. `SMOKE_SCRIPT=test_phases_browser.cjs python browser_smoke.py` exercises the real controls and strongly skewed geometry with temporary test data (macOS/Linux shell syntax).


### Testing with recorded meet playback

Use the updated SwimDataManager's **Replay saved captures** controls to load timestamped capture ZIPs or estimated-timing raw `.bin` files. Choose the captured program or an imported program matching the recording. SwimScoreboard connects to the manager as usual; replay needs no serial port and no scoreboard source configuration changes. Controller and all output formats show **REPLAY**, with **ESTIMATED TIMING** when applicable. Pause freezes the clock while retaining fresh consumer data. Replay stop/restart and a new serial race clear held finishes even when event and heat numbers stay the same. Source identity also prevents replay finish cards carrying into live timing.

Use 1× playback for realistic polling tests; high playback speeds can advance through multiple touches between the scoreboard's 400 ms polls. Manager replay provides the same splits, finals, places and lane-status API as live decoding. Labeling does not establish hardware protocol coverage beyond the manager decoder's supported configuration. Run the sibling manager's `python replay_browser_smoke.py` for a disposable browser integration test covering replay controls, rotated downloads, and scoreboard output.


`SMOKE_SCRIPT=test_time_alignment_browser.cjs python browser_smoke.py` checks five strongly skewed lanes, ensures times fit beneath the identity text, and verifies time position/size scale with the card geometry (macOS/Linux shell syntax).

### Unofficial Personal Best finish badge

Enable **Personal Best fly-in on finish cards** under **Lane overlay timing**. It is off by default. An individual swimmer whose valid final time is strictly faster than their imported seed receives an Auburn Stingrays inspired **PERSONAL BEST / UNOFFICIAL** badge, which flies into their lane finish card and follows its perspective alignment. It uses the existing finish appearance delay, duration, visibility and heat/session/source reset rules. Reduced-motion preferences disable the fly-in.

This is a seed comparison, not a verified lifetime personal record. Ties, zero/missing/invalid times, NT/DQ strings, relay entries and ambiguous multiple entries in one lane do not qualify. Seed times must represent the same event/course as the final; the scoreboard cannot verify course equivalency or historical records. Corrections can add/remove the badge; placement/time updates do not replay an already visible badge's animation. Simulation and replay remain labeled by the overlay.

`SMOKE_SCRIPT=test_personal_best_browser.cjs python browser_smoke.py` checks the saved control, image loading, animation completion, correction handling, layout and live updates using disposable data.

See `AGENTS.md` for the repository map, setup, startup and validation commands used by coding agents in new sessions.
