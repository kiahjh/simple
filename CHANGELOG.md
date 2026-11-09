# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- `simple` (or `simple status`) lists simulators in two groups: yours, and the agents'. Running ones are shown;
  `--all` includes the ones that are off, and `--json` prints every simulator for scripts and agents.
- The dashboard shows the same two groups: running simulators as cards, the rest in a collapsed list, each with a
  button to copy its ID. It refreshes itself every couple of seconds.
- Running simulators show a live thumbnail of their screen on the dashboard, which reconnects by itself if the
  stream is interrupted (for example when the simulator restarts). Requires Node.js 20 or later.
- `simple dashboard` starts a background server if needed and prints the dashboard's address; `--open` opens it.
- `simple server status` and `simple server stop` show and stop the background server.
- `simple --help` and `simple --version`.
