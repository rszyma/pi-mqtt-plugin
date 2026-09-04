# Pi Agent Home Assistant MQTT Plugin

Publishes Pi Agent status to Home Assistant via MQTT Discovery.
No custom Home Assistant code is required.

## How it works

Each agent session registers its own Home Assistant device. The instance id
is ephemeral per process (`hostname-boot-pid-random`), so concurrent agents — on
one machine or many — never share topics or clientIds. Dead sessions report
`offline` via Last Will and Testament and show as `unavailable`.

Set `mqtt.instance_id` (or `PI_AGENT_MQTT_INSTANCE_ID`) for a stable device
instead, e.g. one long-lived host. Only one agent may own an id at a time
(last-writer-wins on state).

Because discovery configs are retained, finished sessions stay registered
(greyed out) until deleted. Show only live agents with
[lovelace-auto-entities](https://github.com/thomasloven/lovelace-auto-entities)
and prune the rest with a periodic cleanup job (see below).

## Installation

```bash
pi install github:rszyma/pi-home-assistant-mqtt
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
    // "instance_id": "stable-id", // default: hostname-boot-pid-random (ephemeral)
    // "project": "my-project", // default: basename of working directory
    "discovery_prefix": "homeassistant",
    "qos": 1,
    "retain_state": true,
    "publish_interval_seconds": 5,
    "will_delay_seconds": 90,
    "controls": { "stop": false },
    "expose": {
      "session": true,
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
| Status | Sensor | `idle`, `working`, `tool`, `waiting`, `error`, `stopping` |
| Busy | Binary Sensor | On while the agent runs a task |
| Session | Sensor | Active session id |
| Model | Sensor | Active model id |
| Project | Sensor | Working directory name, `unknown` when empty |
| Cost | Sensor | Session total $, same number as the footer |
| Last Activity | Sensor | Timestamp of latest state change |
| Stop | Button | Only when `controls.stop` is on |

## Commands

- `/mqtt` — info / reload / edit settings (`/mqtt edit` or `/mqtt edit global`)
- `/mqtt-status` — connection state and metrics
- `/mqtt-clean` — delete this session's discovery entities

## Dashboards

Entity ids are per-session, so pin
[lovelace-auto-entities](https://github.com/thomasloven/lovelace-auto-entities)
filtered on availability instead of fixed cards:

```yaml
type: custom:auto-entities
card:
  type: entities
  title: Pi Agents
filter:
  include:
    - entity_id: "sensor.pi_agent_*_status"
  exclude:
    - state: unavailable
show_empty: true
```

Ids follow `sensor.pi_agent_<instance>_status` (`<instance>` sanitized).
A second card on `sensor.pi_agent_*_project` shows what each session works on.

## Cleanup

Finished sessions stay registered until their retained discovery configs are
deleted. `/mqtt-clean` removes one live session's configs; for the rest, run
a recurring job: find `pi-agent/<node>/availability` topics holding retained
`offline`, map each back to
`<prefix>/{sensor,binary_sensor,button}/<sanitized-node>/*/config`
(`[^a-zA-Z0-9_-]` → `_`), and clear them with empty retained publishes:

```bash
mosquitto_sub -h "$BROKER" -t 'pi-agent/+/availability' --retained-only -v
mosquitto_pub -h "$BROKER" -t "$CONFIG_TOPIC" -n -r
```

Until pruned, stale devices are harmless: `unavailable`, hidden from the
dashboard above, and never triggering `working → idle` automations.

## Automations

Dead sessions go `unavailable`, never `idle`, so completion automations only
fire for live agents. Closing the lid triggers nothing.

```yaml
alias: Pi Agent Finished
triggers:
  - trigger: state
    entity_id: sensor.pi_agent_vm_opencode_1_a1b2c3_status
    from: ["working", "tool"]
    to: "idle"
actions:
  - action: notify.notify
    data: { title: "Pi Agent", message: "Pi Agent completed the task." }
mode: single
```

Replace the entity id with a live one (`/mqtt-status` shows the instance
id). For "any agent finished" across sessions, prefer the auto-entities card
above over per-device automations.

## Development

```bash
npm install      # install deps
npm test         # run tests (vitest)
npm run check    # typecheck (tsc --noEmit)
npm run build    # compile to dist/ (also runs on prepack)
```
