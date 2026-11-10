# simple

Simulator tooling that people and agents use together: agents get full control of simulators (and later
Xcode/Swift toolchains), and the person gets a clear view of what's running and who's using it.

Open source from the start, MIT licensed.

## Shape (agreed)

- A CLI plus a short agent skill. Agents and the person use the same commands.
- The CLI starts a local server on demand. The server keeps live streams open, tracks who owns which simulator,
  and serves a web dashboard on localhost.
- Built on [serve-sim](https://github.com/EvanBacon/serve-sim) (Apache-2.0) as a dependency, not a fork.
  Contribute improvements upstream.
- Progressive disclosure: `simple` alone shows status; a handful of common verbs; anything else passes through to
  serve-sim / simctl.

## Versions and releases (agreed)

- Semantic versioning, starting in `0.x`. Pre-releases for early builds: `0.1.0-alpha.1`, `0.1.0-alpha.2`, …,
  `0.1.0-beta.1`, `0.1.0`. `1.0.0` is for when strangers can depend on it.
- Every release is a git tag (`v0.1.0-alpha.1`) with a GitHub Release. Alphas and betas are marked as pre-releases.
- `CHANGELOG.md` has an "Unreleased" section that each change adds to; it becomes the release notes.
- Decide later: how people install it, and a GitHub Action that builds and publishes on tag push (set up before
  the first alpha).
- First release, `0.1.0-alpha.1`: read-only `simple status` plus a dashboard listing every simulator with a live
  thumbnail and its owner.

## Trial, Nov 9 2026 (Xcode 27.1 beta, serve-sim 0.1.49, AXe 1.8.0)

Setup: a separate device set (`simctl --set`) with an iPhone Duo (iOS 27.1) and iPad Pro 13" M5 (iOS 27.0), Gertrude
Music installed on both.

serve-sim:

- Separate device set works everywhere (`--device-set`). Booting, installing, launching: no windows, Device Hub
  never opened, nothing took focus.
- Live MJPEG stream per device; preview page at `localhost:3200`. Never opens a browser on its own.
- `serve-sim fold <deg>` works (0 closed, 130 book, 180 open), 0.3–4 s. The stream follows the active panel.
  Needs a helper running for that device first.
- Taps (`serve-sim gesture`, coordinates 0–1, begin + end) and typing (`serve-sim type`) work in the background.
  The README's "Device Hub must be frontmost for Xcode 27 typing" didn't apply when Device Hub wasn't attached.
- Undocumented: the helper serves the accessibility tree at `GET /helper/<udid>/ax`, including for separate device
  sets. `prototypes/tap-label.py` taps an element by label using it; worked through Music's onboarding on iPad.
- Helpers are cheap; the simulators are the CPU cost.
- Helpers didn't exit promptly after their simulator shut down; had to kill them. Our server should own their
  lifecycle.

AXe (not adopting):

- No way to target a separate device set, so it can't work with agent-owned simulators.
- Unfolded Duo: screenshot came out solid black (captures the off outer panel) and `tap --label` missed.
- `tap --label` is nice on normal screens; first call per device timed out once while connecting.
- Homebrew install fails on macOS 27 with outdated Command Line Tools; release tarball works.

## Driving Device Hub (Nov 9 2026, Xcode 27.1 beta)

Learned while opening an iPhone and a Duo in Device Hub on request. `prototypes/devicehub-ax.swift` does each step.

- Use the Device Hub inside the Xcode you want (`Xcode 27.1 beta.app/Contents/Applications/DeviceHub.app`,
  bundle `com.apple.dt.Devices`); older ones lack Duo fold controls.
- Never quit Device Hub to "reset" it: that shuts down every running simulator.
- It doesn't open windows for simulators booted with `simctl`, before or after it launches. It registers a
  `devices://` URL scheme, but `devices://<udid>`, `/device/<udid>`, `/simulator/<udid>` and `/open?udid=` all
  did nothing.
- Its accessibility tree is empty until something sets `AXManualAccessibility = true` on the app element; after
  that, everything is reachable (sidebar rows, toolbar, menus). open-computer-use still fails with
  `cgWindowNotFound`, so this needs our own small Swift helper.
- To show a simulator: "Show Sidebar" button → set `AXSelected` on its row. "Open in New Window" turns the
  current window into a compact window for that simulator; File > New Window opens another full window.
- To check results without disturbing the screen: `CGWindowListCopyWindowInfo` for titles,
  `screencapture -x -o -l <windowid>` for one window's image.

## Gotchas to design around

- Unfolded Duo: the inner panel's framebuffer is rotated relative to the app. Raw frames come out sideways, and
  accessibility frames don't map directly to tap coordinates. A raw tap (`gesture --raw`) at panel coordinates
  worked. The tool should handle this so callers never think about it, and screenshots should come out upright.
- The iOS 27.1 runtime only supports the iPhone Duo; iPads need iOS 27.0. Pick runtimes per device type.
- The name `simple` is taken on npm (an old package); decide how to publish (scoped package, Homebrew, etc.) before
  the first release.

## Stack (agreed)

- TypeScript on Bun for the CLI, server and dashboard. Bun can compile to a single binary for distribution.
- serve-sim embedded in-process through its middleware (`serve-sim/middleware`). Checked: its page and `/api`
  serve fine under Bun 1.3.5 and Node 26. Not yet checked: live stream and WebSocket proxying under Bun; verify
  first, and fall back to Node if needed.
- Small Swift helper programs only where Apple frameworks are needed (e.g. straightening rotated Duo frames, Device
  Hub automation), called from the TypeScript core, as serve-sim does.
- Not Rust: no performance need, and a third language for contributors.

## Ownership (agreed)

- Two groups of simulators, both in Xcode's default device set (what Device Hub and Xcode show):
  - The person's: everything `simple` didn't create.
  - Agents': simulators `simple` created, named like "Agent · iPhone 18 Pro" and recorded in simple's data folder.
    Agents only use the simulator they claimed, never the person's.
- Changed Nov 9, 2026 (was: a separate device set for agents). `xcodebuild`, Xcode's run destinations and the
  Xcode MCP only see the default set; no environment variable or setting changes that (checked
  `-showdestinations` with a test simulator in a custom set). So agents couldn't `xcodebuild test` or build and
  run through Xcode on separate-set simulators. Cost of the switch: agent simulators appear in Device Hub's
  sidebar and Xcode's device menu, kept tidy by reusing a small pool and deleting long-unused ones. Device Hub
  doesn't open windows for simulators booted in the background, so they don't pop up on screen.
- Inside the agents' group, each claimed simulator records its owner: the agent session ID (OpenCode sets
  `OPENCODE_SESSION_ID` in agent shells), the project, and when. Released when the agent is done or the session
  ends.
- Agents may use the person's simulators read-only by default (status, thumbnails, screenshots). Tapping, typing or
  anything else that changes them needs an explicit flag.
- Phasing:
  - `0.1.0-alpha.1`: read-only. Shows both groups labeled "you" and "agents", with live thumbnails. No per-session
    owners yet.
  - `0.1.0-alpha.2`: `simple claim` / `simple release`, so owners become per-session.

## Skeleton (agreed)

- One package: `src/cli` (the `simple` command), `src/server` (background server), `src/dashboard` (React page,
  bundled by Bun's HTML imports; no Vite). Plain CSS.
- Argument parsing with the built-in `parseArgs`.
- The first command that needs the server starts it in the background (`simple _server`, detached). Fixed port
  `4729` on 127.0.0.1. Data in `~/Library/Application Support/simple/` (server log: `server.log`).
  `SIMPLE_HOME` / `SIMPLE_PORT` override both, which the tests use.
- Strict TypeScript (TS 7), Biome for formatting and linting, `bun test`. `bun run check` runs all three; the
  `check` GitHub workflow runs it on macOS for every push and PR.
- Checked: compiled with `bun build --compile`, the single binary (86 MB) starts and stops its own server.
- Not handled yet: a running server from an older version isn't restarted after an upgrade.

## 0.1.0-alpha.1 plan (agreed)

Each simulator shows its name, model, OS, state (running / starting / stopping / off), group, and its UDID
(hidden in the UI but easy to copy). Later: front app and disk usage. Running simulators come first; off ones
are tucked away.

Steps, each committed separately:

1. ✅ The list in the terminal: `simple` / `simple status`, `--all`, `--json`. Reads both groups with one
   `xcrun simctl list -j` per device set (~0.15 s total). The agents' device set lives in
   `<data dir>/devices`; it's only read if it exists.
2. ✅ The list on the dashboard: "Yours" and "Agents'" sections, cards for running simulators, a collapsed list
   of off ones, refreshing itself every 2 s by polling `GET /api/simulators` (no caching; each poll runs simctl).
3. ✅ Live thumbnails: `GET /api/simulators/:udid/thumbnail` streams MJPEG through our Bun server (works).
   - serve-sim's raw stream is heavy: full-resolution frames (~200–400 KB), ~5 fps on a still screen (~1.9 MB/s)
     and ~31 fps while moving (~8.5 MB/s). Thumbnails are re-streamed at most 5 fps, always the newest frame
     (~0.9 MB/s measured).
   - Frames are split by each part's Content-Length; serve-sim's JPEGs carry EXIF, so scanning for JPEG
     markers isn't safe.
   - Helpers start on the first thumbnail request (`serve-sim --detach`, run with Node, serve-sim's supported
     runtime), stop 60 s after the last viewer disconnects (verified), stop when their simulator stops running
     (checked on each list refresh), and stop with the server. Helpers someone else started are never stopped.
   - serve-sim also serves `/foreground` (the app in front) and `/config` per helper; useful later.
   - Bug found on the real dashboard (Duo thumbnail blank): two cards starting helpers at the same moment ran two
     `serve-sim --detach` at once, both picked port 3100, and the second failed ("Port 3100 is already in use") or
     hung. Fixed by starting helpers one at a time. Worth reporting upstream to serve-sim.
   - Also: browsers silently stop updating an `<img>` MJPEG stream that ends, so the dashboard reads the stream
     with `fetch` and reconnects (1 s, doubling to 10 s). serve-sim commands time out after 20 s, stream connects
     after 5 s, and failures go to `server.log`.
   - Before distributing a compiled binary: it must ship serve-sim and needs Node on the machine.
4. ✅ Clicking a card's screen opens serve-sim's full interactive view in a new tab, via `GET /sim/:udid`
   (starts the helper if needed, then redirects to `http://127.0.0.1:<helper port>/`; each detached helper
   serves the full preview page at its root).
   - Our server can't see that page's viewers directly, so before stopping an idle helper it asks the helper's
     `/api/diagnostics` how many interactive WebSocket connections it has (`sessions[].hid.sockets`). The full
     view holds one; thumbnails don't. While it's open, the helper stays up.
   - The Duo's full view takes ~5–13 s to go live the first time (its 3D model loads).
   - Later idea: open the full view inside our dashboard instead of a new tab, through serve-sim's middleware.
5. ✅ Release prep. The server reports a build ID: the version plus a fingerprint of `src/`, `package.json` and
   `bun.lock`, taken when it starts (a compiled binary uses just the version). `ensureServer` restarts a server
   whose build ID differs from the CLI's. Costs ~30 ms per command. Released `v0.1.0-alpha.1` on Nov 9, 2026,
   installed from source.

## 0.1.0-alpha.2 plan (agreed)

- `simple claim [MODEL] [--os VERSION] [--json]`: reuse the caller's matching claim, else an idle agent simulator
  of that model (erased first if used), else create "Agent · <model>" (numbered if taken). Waits until booted,
  prints the UDID. MODEL: `duo`, `ipad`, `iphone` (default) or a model name, picking the newest match on the
  newest installed iOS that supports it (`src/catalog.ts`).
- Owner: `opencode:<OPENCODE_SESSION_ID>` labeled with the project folder; `--owner NAME` / `SIMPLE_OWNER`;
  otherwise "you". Any simple command refreshes the caller's claims; they lapse after 2 hours without one.
- `simple release [ID] [--force]`: shut down and erase, keep the simulator for reuse. Others' need `--force`.
- Agent simulators unused for 7 days are deleted. The server tidies every minute; `simple claim` tidies too.
- State: `<data dir>/agents.json`, changed only under a lock (a directory, stale after 60 s).
- Measured: first claim (create + first boot) 68 s; same owner again 2 s; release 4 s; claim after a release
  48 s, because erasing makes the next boot a first boot. Kept as is for simplicity (Nov 9, 2026). Considered
  and declined for now: a warm, already-booted spare for ~2 s claims; skipping the erase (fast but leaks state).

## serve-sim opens Simulator.app (patched, Nov 9 2026)

- When serve-sim starts a helper for a simulator in Xcode's default device set, it runs `open -ga Simulator`
  ("so the display pipeline is wired up"). On Xcode 27 there's no Simulator.app, so macOS opens an older Xcode's
  (here 26.6), which shows windows for running simulators. Found by watching the system log for `open` while
  repeating each step; only starting a helper triggered it.
- Not needed for us: streaming, taps and typing all worked without it (trial, and re-checked after patching).
  Rotation (`serve-sim rotate`) didn't seem to take effect without it; serve-sim's native code says rotation
  needs Simulator.app running. Revisit if we add rotation.
- We remove that one call with `bun patch` (`patches/serve-sim@0.1.49.patch`). Upgrading serve-sim needs the
  patch redone. Not reported upstream: it's reasonable behavior on older Xcode versions.
- Quitting the old Simulator.app shuts down the simulators it was showing.

- Install a missing iOS runtime on request (Xcode can download runtimes from the command line).
- Device settings on claim, e.g. `--dark`, language, text size.
- A warm spare for ~2 s claims (declined for now, see the alpha.2 plan).
- Say in `--help` that `claim` is meant for agents (people can still use it).
- A "Release" button on the dashboard for agent simulators.
- Open the full view inside the dashboard instead of a new tab (serve-sim's middleware).
- "Show in Device Hub" for a simulator (see "Driving Device Hub").
- Report serve-sim's port race on simultaneous `--detach` upstream.
- Packaged installs (Homebrew or a single binary), which must bring serve-sim and need Node.

## How to release

1. Move the changelog's "Unreleased" entries under a new `## [x.y.z] - YYYY-MM-DD` heading, add a one-line
   summary, and update the comparison links at the bottom.
2. Set `version` in `package.json`. Commit as "Release x.y.z" and push; wait for the `check` workflow to pass.
3. `git tag -a vx.y.z -m "simple x.y.z"`, `git push origin vx.y.z`.
4. `gh release create vx.y.z --title "simple x.y.z" --notes-file <that changelog section>`, with `--prerelease`
   for alphas and betas.
