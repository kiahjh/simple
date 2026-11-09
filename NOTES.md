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

## Gotchas to design around

- Unfolded Duo: the inner panel's framebuffer is rotated relative to the app. Raw frames come out sideways, and
  accessibility frames don't map directly to tap coordinates. A raw tap (`gesture --raw`) at panel coordinates
  worked. The tool should handle this so callers never think about it, and screenshots should come out upright.
- The iOS 27.1 runtime only supports the iPhone Duo; iPads need iOS 27.0. Pick runtimes per device type.
- The name `simple` is taken on npm (an old package); decide how to publish (scoped package, Homebrew, etc.) before
  the first release.

## Next decision

What version one is. Suggestion: `simple status` plus a dashboard listing every simulator with a live thumbnail
and its owner. No interaction or toolchains yet.
