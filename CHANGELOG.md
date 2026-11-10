# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha.3] - 2026-11-10

Agents can see and use their simulators: screenshot, ui, tap, type and fold.

- Commands to see and use a simulator, acting on the one you hold (or `--sim ID-or-name`):
  - `simple screenshot` saves an upright screenshot of whichever screen is showing, including the iPhone Duo's
    sideways inner screen, and prints its path.
  - `simple ui` lists what's on screen (buttons, text, fields) with their positions; `--json` for scripts.
  - `simple tap "<label>"` taps by label (exact, then partial; `--index` picks among matches), or `--at X,Y`.
  - `simple type "<text>"` types into whatever has focus.
  - `simple fold open|book|closed|DEGREES` folds an iPhone Duo.
  - Changing a simulator you don't hold needs `--force`.
- `simple claim` takes keyboard input back from Xcode 27's Device Hub, so typing works on agent simulators.
- serve-sim no longer opens an old Xcode's Simulator app.
- Known limitation: tapping a folded iPhone Duo's outer screen crashes the simulator's touch system, so
  `simple tap` refuses until it's unfolded.

## [0.1.0-alpha.2] - 2026-11-09

Agents get their own simulators: `simple claim` and `simple release`.

- `simple claim [MODEL]` gives an agent its own booted simulator and prints its ID. MODEL is `duo`, `ipad`,
  `iphone` (the default) or a model name; `--os` picks an iOS version. Agent simulators live in Xcode's normal
  device list (named "Agent · …"), so `xcodebuild`, Xcode and the Xcode MCP can use them. An idle one is reused
  before a new one is created.
- `simple release [ID]` hands the caller's simulators back; they're shut down and erased for the next agent.
  Releasing someone else's needs `--force`.
- `simple` shows who holds each agent simulator and since when. Claims lapse after 2 hours without a `simple`
  command from their owner, and agent simulators unused for 7 days are deleted.
- Owners are identified by their OpenCode session (labeled with the project folder), `--owner NAME`, or "you".
- The dashboard shows who holds each agent simulator and since when.
- `skills/simple/SKILL.md`: a short skill telling coding agents to claim their own simulator.

## [0.1.0-alpha.1] - 2026-11-09

The first alpha: see what simulators are running, and watch them live.

- `simple` (or `simple status`) lists simulators in two groups: yours, and the agents'. Running ones are shown;
  `--all` includes the ones that are off, and `--json` prints every simulator for scripts and agents.
- `simple dashboard` starts a background server if needed and prints the dashboard's address; `--open` opens it.
- The dashboard shows the same two groups: running simulators as cards, the rest in a collapsed list, each with a
  button to copy its ID. It refreshes itself every couple of seconds.
- Running simulators show a live thumbnail of their screen, which reconnects by itself if the stream is
  interrupted (for example when the simulator restarts). Requires Node.js 20 or later.
- Clicking a running simulator's thumbnail opens serve-sim's full interactive view of it in a new tab (touch,
  keyboard, rotation, and fold controls for the iPhone Duo).
- The background server restarts itself when it's running older code, for example after an update.
- `simple server status` and `simple server stop` show and stop the background server.
- `simple --help` and `simple --version`.

[Unreleased]: https://github.com/kiahjh/simple/compare/v0.1.0-alpha.3...HEAD
[0.1.0-alpha.3]: https://github.com/kiahjh/simple/compare/v0.1.0-alpha.2...v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/kiahjh/simple/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/kiahjh/simple/releases/tag/v0.1.0-alpha.1
