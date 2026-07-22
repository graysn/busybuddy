# BusyBuddy

Sync two [BUSY Bars](https://busy.app/) so you and your partner can see **each other's status at a glance**, without giving up any of your own bar's functionality.

Your half of the 72×16 screen is fully yours — set custom statuses, run the built-in Pomodoro timer to focus. The other half mirrors your partner's status live. When they start a meeting or you hit record, both bars update instantly and the LED blinks so the other person notices from across the house.

```
 col 0 .......... 34 | 35 36 | 37 .......... 71
    ┌──────────────┐   gap    ┌──────────────┐
    │ Grayson      │          │ Erik         │
    │ Recording ●  │          │ Focus  24:58 │   ← live countdown on the device
    └──────────────┘          └──────────────┘
      ↑ your side (you control)  ↑ partner (mirrored)
```

## How it works

BUSY Bar "widgets" are programs that run on a computer and drive the device over
its [HTTP API](https://docs.busy.app/bar/dev/http-api). BusyBuddy is one such
program, run once per person:

- **Agent** (`busybuddy run`) — runs on your machine, talks to *your* bar via the
  official [`@busy-app/busy-lib`](https://www.npmjs.com/package/@busy-app/busy-lib)
  client, owns your status + Pomodoro, and redraws the split screen.
- **Relay** (`busybuddy serve`) — a tiny WebSocket server both agents connect to.
  Each agent publishes its own status and receives the partner's. Run it anywhere
  both of you can reach: a home server, a spare Pi, or a small VPS. It stores
  nothing and needs no database.

```
  Grayson's bar ── agent ─┐                 ┌─ agent ── Erik's bar
                          ├──► relay (ws) ◄──┤
        renders both  ◄───┘                 └───►  renders both
```

Presence is tracked automatically: agents re-publish on a heartbeat, so a frozen
or disconnected partner shows as **stale** and then **offline** rather than a
lie.

## Quick start

```bash
npm install
npm run build

# 1. Start the relay somewhere reachable by both of you
busybuddy serve --port 8787

# 2. Each partner copies the example config and edits it
cp busybuddy.config.example.json busybuddy.config.json
#    set your `name`, `partnerName`, the same `sync.room` code,
#    the relay's `sync.url`, and your bar's `bar.addr`.

# 3. Run your agent (leave it running; it also serves a local control API)
busybuddy run
```

Try it **without a device** first — `busybuddy run --dry-run` prints an ASCII
preview of the two cards instead of drawing to hardware. Even quicker, run the
built-in demo, which starts a relay and two dry-run agents in one process and
plays out a short scene (recording, Pomodoro, meeting, LED alerts):

```bash
npm run demo
```

## Playground — test it interactively (no hardware)

The fastest way to actually *try* BusyBuddy and see what works: one command
starts the whole stack (relay + two bar emulators + two agents) and opens a
browser control panel where **you drive both sides yourself** and watch both
bars react live. Nothing scripted.

```bash
npm run playground
# → open http://127.0.0.1:8080
# optional names:  npm run playground -- --you Grayson --partner Erik
```

Each panel is one person's bar (their status on the left card, their partner on
the right). Click a status or a Pomodoro control on either side and both
previews update, along with a plain-text readout of each person's status,
timer, and whether they can see their partner.

## Emulator (single screen / real hardware stand-in)

Under the playground is a reusable emulator: a local server that speaks the real
BUSY Bar HTTP API and renders the 72×16 screen in your browser. Point an agent's
`bar.addr` at it exactly like a physical device — handy if you own **one** bar
and want an emulated partner:

```bash
npm run emulate -- --port 10420 --label "Partner's bar"
# then set "bar": { "addr": "http://127.0.0.1:10420" } in a config and `busybuddy run`
```

There's also a scripted two-bar loop if you just want a quick look:
`npm run demo:visual` (opens two emulator URLs and plays a fixed scene).

The emulator approximates fonts and scrolling — it's for reading layout, color,
the live countdown, and LED alerts, not a pixel-perfect replica.

> **Note on the LED alert:** the notification-LED blink is sent via the draw
> request's `led_notification_color`. The official `@busy-app/busy-lib` client
> (v0.17.0) drops that field, so BusyBuddy talks to the device over its HTTP API
> directly (`src/device.ts`) to preserve it. The emulator honors it too.

## Controlling your status

While `busybuddy run` is active you can drive it from the same terminal
(keyboard) or from any other terminal (the `set` / `pomodoro` commands talk to
the running agent's local control API):

```bash
busybuddy set recording          # switch your status
busybuddy pomodoro start         # start a focus session
busybuddy pomodoro pause         # pause / resume / stop / skip
busybuddy status                 # show both sides + timer
busybuddy statuses               # list available status ids
```

Keyboard shortcuts in the `run` terminal: number keys pick a status, `p`
starts/pauses Pomodoro, `k` skips a phase, `x` stops the timer, `q` quits.

## Statuses

Built-in: `available`, `focus`, `meeting`, `call`, `recording`, `dnd`, `brb`,
`away`, `offline`. Statuses with an alert (meeting/call/recording) blink the
notification LED — that's what makes the *other* bar visibly react.

Add or override statuses in config:

```json
"customStatuses": [
  { "id": "recording", "label": "Recording", "color": "#DC2626FF", "alert": true },
  { "id": "school",    "label": "Homework",  "color": "#8B5CF6FF" }
]
```

Colors are `#RRGGBB` or `#RRGGBBAA`. The status color tints your card so it reads
from across the room; the label adds detail up close.

## Pomodoro

Configurable focus/break/long-break durations and cycle count. While focusing,
your status automatically becomes your `focusStatusId` (default `focus`) so your
partner sees you're heads-down; breaks switch to `breakStatusId`. The countdown
is drawn with the device's native `countdown` element, so it ticks smoothly on
the LED matrix without constant redraws.

## Configuration

See [`busybuddy.config.example.json`](./busybuddy.config.example.json). Secrets
and connection details can be overridden with environment variables so they stay
out of the file:

| Env var | Overrides |
| --- | --- |
| `BUSYBUDDY_BAR_ADDR` | `bar.addr` (device IP / hostname / cloud proxy URL) |
| `BUSYBUDDY_BAR_TOKEN` | `bar.token` (cloud proxy bearer token) |
| `BUSYBUDDY_BAR_PASSWORD` | `bar.httpAccessPassword` (local HTTP password) |
| `BUSYBUDDY_SYNC_URL` | `sync.url` |
| `BUSYBUDDY_ROOM` | `sync.room` |

### Connecting to your bar

`bar.addr` accepts any of the connection modes the library supports:

- **USB-Ethernet:** `10.0.4.20`
- **Wi-Fi LAN:** the bar's LAN IP, e.g. `192.168.1.37`
- **Cloud proxy (from anywhere):** `https://api.busy.app` plus a `bar.token`
  from <https://cloud.busy.app/api-tokens>

`bar.priority` (default `60`) controls how forcefully BusyBuddy claims the
screen: built-in apps draw at 10 and a manually started BUSY work session at 90,
so 60 keeps BusyBuddy visible over ordinary apps while yielding to an explicit
work session.

## Development

```bash
npm test         # run the test suite (vitest)
npm run test:watch
npm run typecheck
npm run dev -- run --dry-run   # run from source without building
npm run playground             # interactive two-bar test panel in the browser
npm run demo                   # scripted end-to-end scene (text), no hardware
npm run demo:visual            # two browser emulators + full stack, looping scene
npm run emulate -- --port 10420  # a single browser emulator
```

### Layout

| Path | What |
| --- | --- |
| `src/types.ts` | Shared status/timer types |
| `src/color.ts` | `#RRGGBBAA` parsing, dimming, contrast |
| `src/statuses.ts` | Built-in + custom status catalog |
| `src/pomodoro.ts` | Clock-injectable Pomodoro state machine |
| `src/render.ts` | Pure `composeFrame()` → BUSY Bar draw command |
| `src/sync/hub.ts` | Pure room/routing logic |
| `src/sync/server.ts` | WebSocket relay adapter |
| `src/sync/client.ts` | Reconnecting client with presence tracking |
| `src/device.ts` | Direct BUSY Bar HTTP client (sends `led_notification_color`) |
| `src/bar.ts` | Device adapter + mock/dry-run |
| `src/emulator/` | Browser emulator: device API server + canvas viewer |
| `src/playground/` | Interactive two-bar test panel (server + control page) |
| `src/app.ts` | Orchestrator wiring state → render → sync |
| `src/cli.ts` | `serve` / `run` / `set` / `pomodoro` / `status` |

The rendering, Pomodoro, and sync-routing logic are pure and unit-tested; the
server↔client path is covered by an integration test on a live loopback socket.

## License

MIT
