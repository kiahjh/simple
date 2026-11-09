# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kiahjh/simple/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/kiahjh/simple/releases/tag/v0.1.0-alpha.1
