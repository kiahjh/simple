# simple

Simulator tooling for people and agents, together. Agents get full control of iOS simulators; you get a clear view
of what's running and who's using it.

**Status: pre-alpha.** Nothing useful yet. The first release will be `0.1.0-alpha.1`.

Built on [serve-sim](https://github.com/EvanBacon/serve-sim).

## Development

Requires macOS and [Bun](https://bun.sh) (version in `.bun-version`).

```sh
bun install
bun run simple --help     # run the CLI from source
bun run check             # type check, lint and test
bun run format            # format and fix lint issues
```

Set `SIMPLE_DEV=1` for hot reloading while working on the dashboard. `SIMPLE_HOME` and `SIMPLE_PORT` override
where data is kept and which port the server uses.

## License

MIT
