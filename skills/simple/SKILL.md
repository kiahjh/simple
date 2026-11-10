---

name: simple
description: Use whenever you need an iOS simulator, to build, run, test or look at an app. Gives you your own simulator so you never use the user's.
---

Get your own booted simulator with `simple claim [duo|ipad|iphone|"<model name>"]`. It prints the simulator's ID;
use it with `xcodebuild -destination id=<ID>`, `xcrun simctl`, or the Xcode MCP. A new claim can take about a
minute while the simulator boots.

To see and use it: `simple screenshot`, `simple ui` (what's on screen), `simple tap "<label>"`, `simple type
"<text>"`, `simple fold open|closed`. They act on the simulator you hold.

Don't use the user's simulators (listed under "You" by `simple`) unless they ask. Never quit Device Hub: it
shuts down every running simulator.

Run `simple release` when you're done. See `simple --help` for the rest.
