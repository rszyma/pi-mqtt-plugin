# Pi Agent Home Assistant MQTT Plugin

Publishes Pi Agent status to Home Assistant via MQTT Discovery.
No custom Home Assistant code is required.

## How it works

Each agent session registers its own Home Assistant device. The instance id
is the pi session id, so concurrent agents never share topics or clientIds,
`/new` and forks mint fresh devices, and resumes reclaim the same device
(retained discovery configs still apply). Dead sessions report `offline` via
Last Will and Testament and show as `unavailable`.

Set `mqtt.instance_id` (or `PI_AGENT_MQTT_INSTANCE_ID`) for a stable device
instead, e.g. one long-lived host. Only one agent may own an id at a time
(last-writer-wins on state). Without it the id falls back to an ephemeral
per-process id (`hostname-boot-pid-random`) before a session exists.

Because discovery configs are retained, finished sessions stay registered
(greyed out) until deleted. Show only live agents with
[lovelace-auto-entities](https://github.com/thomasloven/lovelace-auto-entities)
and prune the rest with a periodic cleanup job (see below).

## Installation

```bash
pi install github:rszyma/pi-mqtt-plugin
```

Unbuilt checkouts (clone or local path) need a build first:

```bash
npm run build
pi install .
```

## Configuration

`mqtt` key in `~/.pi/agent/settings.json` (global) or `.pi/settings.json`
(project, overrides global). Env vars override both.

```json
{
  "mqtt": {
    // "broker": "mqtt://192.168.1.50:1883", // default: mqtt://127.0.0.1:1883
    // "username": "pi-agent", // default: unset (anonymous)
    // "password_env": "PI_AGENT_MQTT_PASSWORD", // default: unset
    // "device_name": "Pi Agent on Workstation", // default: Pi Agent on <hostname>
    // "instance_id": "stable-id", // default: pi session id (one device per session)
    // "project": "my-project", // default: basename of working directory
    "discovery_prefix": "homeassistant",
    "qos": 1,
    "retain_state": true,
    "publish_interval_seconds": 5,
    "will_delay_seconds": 90,
    "controls": { "stop": false },
    "expose": {
      "model": true,
      "project": true,
      "cost": true,
      "tool": true,
      "token_usage": true,
      "errors": true,
      "context_percent": true
    }
  }
}
```

`will_delay_seconds` (MQTT 5 only, `0` disables) holds the LWT `offline`
back so short sleeps do not flap sessions to `unavailable`. Graceful
shutdown still publishes `offline` immediately. `project` labels what the
session works on; dynamic lists can render it without parsing device names.

Env vars: `PI_AGENT_MQTT_BROKER`, `PI_AGENT_MQTT_USERNAME`,
`PI_AGENT_MQTT_PASSWORD` (or `PI_AGENT_MQTT_PASSWORD_ENV` naming the var),
`PI_AGENT_MQTT_INSTANCE_ID`, `PI_AGENT_MQTT_PROJECT`,
`PI_AGENT_MQTT_WILL_DELAY_SECONDS`, `PI_AGENT_MQTT_DEVICE_NAME`,
`PI_AGENT_MQTT_BASE_TOPIC` (`pi-agent/<instance_id>`),
`PI_AGENT_MQTT_DISCOVERY_PREFIX`, `PI_AGENT_MQTT_ENABLE_STOP=true`.

## Entities

| Entity | Type | Notes |
| --- | --- | --- |
| Status | Sensor | `idle`, `working`, `tool`, `waiting`, `error`, `stopping`, `compacting` (+ `session` attribute) |
| Busy | Binary Sensor | On while the agent runs a task |
| Model | Sensor | Active model id |
| Project | Sensor | Working directory name, `unknown` when empty |
| Cost | Sensor | Session total $, same number as the footer |
| Last Activity | Sensor | Timestamp of latest state change |
| Stop | Button | Only when `controls.stop` is on |

## Commands

- `/mqtt-status` — connection state and settings

## Home Assistant integration

See [docs/home-assistant.md](docs/home-assistant.md) for a guide
on how to setup dashboards, auto-cleanup, auto-labels, and automations
helpful for a better synergy with [MQTT Home Assistant Integration](https://www.home-assistant.io/integrations/mqtt/).

## Development

```bash
npm install      # install deps
npm test         # run tests (vitest)
npm run check    # typecheck (tsc --noEmit)
npm run build    # compile to dist/ (also runs on prepack)
```
