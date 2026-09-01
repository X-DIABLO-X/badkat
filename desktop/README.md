# morphcat desktop

A cat that lives along the bottom of your screen, notices when you have been
watching Shorts / Reels / TikTok for too long, stomps over, and closes it.

Windows. The character is the same rig as the demo in the repo root — the same
`js/cat-shapes.js` and `js/cat.js`, mounted into a transparent overlay window
instead of a web page.

```bash
cd desktop
npm install
npm start
```

It runs from the tray. Right-click the tray cat for pause, snooze, mode, and
the rules file.

## What it does

1. A PowerShell helper reports the foreground window's title and process, once
   a second. Nothing else is read, and nothing leaves the machine.
2. `rules.js` matches that against a list of patterns. Each rule has a `grace`
   — how long that window has to hold your attention before the cat cares.
3. A few seconds before the grace runs out the cat stops wandering and stares
   at you. That pause is the real warning.
4. When the grace expires the cat turns angry, storms across the screen with a
   💢 over its head, and shows a countdown.
5. At zero it closes the thing: `Ctrl+W` for a browser (closes just that tab)
   or `WM_CLOSE` for anything else.

Click the cat during the countdown and it snoozes for five minutes instead.
Click it any other time and it is happy about it. You can drag it along the
bottom of the screen.

## Safety

The gap between deciding and acting is where a tool like this can do damage,
so the close is gated twice:

- `close-target.ps1` re-checks that the offending window is **still the
  foreground window** and that its title still matches, immediately before it
  acts. Alt-tab away during the countdown and nothing happens.
- Browsers get `Ctrl+W`, not a window close, so at most you lose the one tab
  that was already in front of you.

If you want to calibrate rules without anything closing, switch the tray menu
to **Only complain (nag)**. The cat still gets cross; it just does not act.

## Rules

The rules live in a JSON file you can edit — tray menu → *Edit rules…*
(`%APPDATA%/morphcat-desktop/config.json`). Then *Reload rules*.

```json
{
  "id": "youtube-shorts",
  "label": "YouTube Shorts",
  "all": ["youtube", "shorts"],
  "grace": 6,
  "action": "tab"
}
```

- `all` — every pattern must appear in the window title (or process name)
- `any` — at least one must appear
- `grace` — seconds the window must stay in front before the cat reacts
- `action` — `tab` (Ctrl+W, browsers) or `close` (WM_CLOSE)

Patterns are plain case-insensitive substrings, matched against
`title + "   " + processName`.

Top-level settings: `enabled`, `mode` (`close` / `nag`), `countdownSeconds`,
`snoozeMinutes`, `pollMs`, and `never` — a list of substrings that are never
touched no matter what else matches.

The graces in the defaults are deliberately uneven. Shorts and Reels get 6
seconds because there is no such thing as a quick look. YouTube proper gets
240, because a lot of YouTube is work. Reddit gets 90. Tune them.

A rule with no `all` and no `any` would match nothing, and a config file saved
with a UTF-8 BOM used to throw the whole file away silently — both are now
handled: bad rules are dropped with a message and the BOM is stripped.

## Files

| File | What it does |
| --- | --- |
| `main.js` | overlay window, tray, rule evaluation, IPC |
| `monitor.js` | wraps the foreground watcher, tracks dwell time |
| `rules.js` | default rules, matching, config validation |
| `enforcer.js` | runs the close script and reports what happened |
| `preload.js` | the five calls the overlay is allowed to make |
| `pet.html` / `pet.css` / `pet.js` | the overlay and the cat's desktop behaviour |
| `tray-icon.js` | draws and PNG-encodes the tray glyph at runtime |
| `scripts/*.ps1` | the two Win32 calls: read foreground, close target |

## How the overlay works

The window is the full width of the work area, 260px tall, glued to the bottom,
transparent, frameless, always-on-top and `focusable: false` so it never steals
focus. It is click-through by default; `pet.js` watches forwarded mouse moves
and flips `setIgnoreMouseEvents` off only while the pointer is actually over
the cat or its bubble.

`pet.js` drives the cat's position itself rather than using `cat.js`'s built-in
roam, because a desktop is much wider than the demo stage. It gets the walk
speed from `Cat.groundSpeed()` — design units per second implied by the gait —
so the paws stay planted at any speed.

## Troubleshooting

`npm start -- --diagnose` writes `.shot-pet.png` (an Electron-composited
screenshot of the overlay) and `.shot-pet.json` (cat state, the foreground
window, and the last few decisions) to the repo root every 2.5 seconds.

This exists because a transparent, always-on-top window is invisible to most
screen-capture APIs — `CopyFromScreen` and `PrintWindow` both come back blank
or fragmentary, so there is otherwise no way to see what the cat is doing.

If nothing ever triggers, check `.shot-pet.json`: `configError` tells you the
config failed to parse, `ruleCount` tells you how many rules survived
validation, and `trail` shows the `matched` → `bust` → `act` sequence with the
reason if an action was skipped.
