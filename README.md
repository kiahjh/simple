# simple

Simulator tooling for people and agents, together. Agents get full control of iOS simulators; you get a clear view
of what's running and who's using it.

**Status: alpha.** Things will change, and some will break. Built on
[serve-sim](https://github.com/EvanBacon/serve-sim).

## What it does today

- `simple` lists your simulators and the agents' in the terminal. `--all` includes the ones that are off; `--json`
  is for scripts and agents.
- `simple dashboard --open` opens a local dashboard with live thumbnails of every running simulator. Click one to
  open serve-sim's full interactive view (touch, keyboard, rotation, and folding for the iPhone Duo).

## Install (from source, for now)

Requires an Apple silicon Mac with Xcode, [Bun](https://bun.sh) 1.4.4 or later, and Node.js 20 or later.

```sh
git clone https://github.com/kiahjh/simple.git
cd simple
bun install
ln -s "$PWD/src/cli/main.ts" ~/.local/bin/simple   # or any folder on your PATH
```

To update: `git pull && bun install`. The background server restarts itself the next time it's needed.

## Development

```sh
bun run simple --help     # run the CLI from source
bun run check             # type check, lint and test
bun run format            # format and fix lint issues
```

Set `SIMPLE_DEV=1` for hot reloading while working on the dashboard. `SIMPLE_HOME` and `SIMPLE_PORT` override
where data is kept and which port the server uses. Decisions and their reasons are in `NOTES.md`.

## License

MIT
