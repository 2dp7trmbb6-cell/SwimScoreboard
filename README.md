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

Select any combination of first name, last name, team, seed, latest split, and final time. The control preview format does not switch explicit OBS URLs; each source keeps its format. Show output controls both formats. Disable the source in OBS to hide everything, including status badges.

For pool alignment, select lane overlays, turn off automatic hiding, and show output. Enter each lane card's four corners in 1920×1080 canvas pixels, in perimeter order (top left, top right, bottom right, bottom left). Each card uses a perspective transform. Coordinates may range from −10000 to 10000; negative or beyond-canvas positions permit partially visible lanes. Disable unused lanes. Alignment currently supports lanes 1–8; the traditional board displays all imported lanes. Settings are shared across OBS views and saved automatically; invalid/self-crossing corners are rejected with a visible save error. Recalibrate after camera or OBS scene transforms change.

Automatic hiding applies to lane cards when a fresh, connected clock exceeds 0.5 seconds. They reappear when the source reports a reset/stopped clock or changes to a pre-race heat with reset timing. If the console retains its finishing clock, use manual visibility until it resets. No race-start signal exists in the current API. Disconnection shows a status badge; old race clocks and results are withheld. Program remains visible with that warning. Simulation is always labeled. Turn off automatic hiding for finish cards or continuous display.

## Timing availability and optional API extension

**Legacy SwimDataManager versions do not expose seed, split, or lane final times.** These fields display `—` until the manager supplies them; the scoreboard never fabricates them. The companion manager update adds seed imports, local lane-result entry/API, and simulated results. Physical CTS lane decoding still requires a verified protocol mapping. Relay legs sharing a lane are combined in one card; first leg supplies the team.

The scoreboard can consume this optional API extension: swimmer `seedTime` as a display string; `feed.results` scoped to current event/heat:

```json
{"event":3,"heat":2,"lanes":{"2":{"splits":["0:28.31","0:58.42"],"finalTime":"0:58.42"}}}
```

Results are displayed only while manager polling is fresh and event/heat match. A supplied session ID must match the active session. Results can remain visible after the race clock stops; manually entered results carry a visible label. Session changes must clear manager results. Names accept either `Last, First` or `First Last`; compound names without commas use the final word as the last name. Validate physical CTS timing and race transitions at the venue before broadcast use.

## Validation

- `python -m unittest -v`: configuration validation/persistence, HTTP controls and origin checks, real sibling SwimDataManager integration, simulation, heartbeat, source stop, and outage. Integration test requires sibling `../SwimDataManager`.
- `node test_render.cjs`: roster escaping, field selection, stale clocks, heat changes, visibility, and perspective matrix. Uses only Node built-ins.
- Optional `node test_browser.cjs`: requires Playwright and Chromium, a scoreboard server on port 8780 connected to a simulated meet with lane 2 `Smith, Jamie` and a clock beyond 0.5 seconds. Uses temporary/test settings only: this test changes visibility and field selections. Browser validation was not executed successfully here because the Chromium download domain was denied.

Physical serial/OBS capture and camera alignment require venue acceptance testing.


If seed times show —, check the seed status under swimmer details, enable **Seed time**, and use **Update report** in the manager to re-import sessions saved before seed support. Restart the updated manager first. Manager session counts distinguish timed seeds, NT, and missing values. An older stored program cannot reconstruct seed values discarded during its original import.
