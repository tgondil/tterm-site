# Changelog demo media

## Auto-generated clips (OpenScreen-style, no Screen Studio)

`scripts/screencast.mjs` produces proper Screen Studio-style clips: it drives the
real app, captures frames, then post-produces with `scripts/screencast/` —
gradient background, a rounded/shadowed window, an eased **auto-zoom** that pushes
toward the action, and a rendered **cursor** with click ripples. Because the scene
is scripted, the zoom/cursor timeline is authored deterministically (the
`SCENARIOS` map), not guessed from telemetry.

```sh
node scripts/screencast.mjs              # all scenarios
node scripts/screencast.mjs assistant    # just one
```

Generated and used on the page: `assistant.mp4`, `commands.mp4` (+ `.png`
posters). Renderer-only capture (`capturePage`), so it's for DOM/canvas surfaces
(assistant, palette, mascot). Native browser panes and the dimmed picker overlay
don't capture well headlessly — record those in Screen Studio (below).

To add a scenario: add an entry to `SCENARIOS` in `scripts/screencast.mjs` with a
`drive` (smoke-harness action ids), a `zoom` keyframe list, and an optional
`cursor` path + `clicks` (times, seconds). Coords are fractions (0..1) of the
capture.

## Screen Studio slots (best for the browser agent + picker)

Record a short (5-10s) muted, looping clip → `docs/media/<name>.mp4` (H.264,
~1280px). The page frames it in CSS, so record on a clean desktop.

| file | feature | shot |
| --- | --- | --- |
| `browser-agent.mp4` | Browser agent | Ask the assistant to add a Google Calendar event; show it drive the browser and land it. |
| `picker.mp4` | Self-improve | ⌘⇧E, hover a component, click it, show the scope chip appear. |

Drop the file in and swap the section's `<img>` for a `<video>` in
`docs/changelog.html`.
