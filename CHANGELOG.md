# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- `simple` (or `simple status`) lists simulators in two groups: yours, and the agents'. Running ones are shown;
  `--all` includes the ones that are off, and `--json` prints every simulator for scripts and agents.
- `simple dashboard` starts a background server if needed and prints the dashboard's address; `--open` opens it.
- `simple server status` and `simple server stop` show and stop the background server.
- `simple --help` and `simple --version`.
