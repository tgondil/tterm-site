# Changelog demo media

Each feature on `changelog.html` has a media slot. Two ways to fill one:

## A. Record it in Screen Studio (best quality)

Record a short (5-10s), muted, looping clip and export to `docs/media/<name>.mp4`
(H.264, ~1280px wide). The page already frames it (rounded corners, gradient
panel, soft shadow) — record on a clean desktop, no need to add your own frame.

Slots and what to capture:

| file | feature | shot |
| --- | --- | --- |
| `browser-agent.mp4` | Browser agent | Ask the assistant to add something to Google Calendar; show it drive the browser and land the event. |
| `assistant.mp4` | Assistant | Type a request, watch it edit a file / run a command and report back. |
| `picker.mp4` | Self-improve | Press ⌘⇧E, hover a component, click it, show the scope chip appear in the assistant. |
| `signin.mp4` (optional) | Google sign-in | Open a Google page in a pane and show it signed in. |

Drop the file in and the page picks it up (the poster shows until it loads).

## B. Auto-capture from the app (no Screen Studio)

`scripts/capture-clip.mjs` drives the real app, captures renderer frames, and
encodes them with ffmpeg. Renderer-only (`capturePage`), so it's for DOM/canvas
features (assistant, mascot, word-art, palette, picker) — native browser panes
won't appear, so use path A for the browser-agent shot.

```sh
node scripts/capture-clip.mjs assistant "toggle-agent-chat" 24 5
node scripts/capture-clip.mjs picker "improve-tterm" 24 5
```

Args: `<name> "<drive-actions>" [fps] [secs]`. Drive actions are the same ids
the smoke harness accepts (comma-separated). Writes `docs/media/<name>.mp4` and
a `<name>.png` poster. `assistant.mp4` and `picker.mp4` here were made this way.
