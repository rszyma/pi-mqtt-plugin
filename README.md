# Pi Agent Home Assistant MQTT Plugin

## Description
This plugin connects Pi Agent to an MQTT broker.
The plugin publishes Home Assistant MQTT Discovery configuration.
The plugin publishes agent status and metadata.
Home Assistant creates entities automatically through MQTT Discovery.
No custom Home Assistant code is required.

## Features
- Automatic entity discovery in Home Assistant
- One Home Assistant device per agent session (ephemeral by default)
- State updates for `idle`, `working`, `tool`, `waiting`, `error`, and `stopping`
- MQTT Last Will and Testament for availability detection (with will-delay for sleep)
- Safe defaults without prompt or response leakage
- Multi-instance support: concurrent agents never share topics or clientIds

## Entities

| Entity | Type | Description |
| --- | --- | --- |
| Status | Sensor | Reports current lifecycle state |
| Busy | Binary Sensor | Reports if agent runs an active task |
| Session | Sensor | Reports active session identifier |
| Model | Sensor | Reports active model identifier |
| Holder | Sensor | Reports what this session works on (`free` when unset, e.g. project name) |
| Last Activity | Sensor | Reports timestamp of latest state change |
| Stop | Button | Optional control button to cancel current work |

## Installation

Install the package with the Pi package manager:

```bash
pi install github:rszyma/pi-home-assistant-mqtt
```

The package declares `./dist/index.js`, so an unbuilt local checkout
(clone or local path) must run the build before Pi loads it:

```bash
npm run build
pi install ./pi-home-assistant-mqtt
```

## Identity model: one device per session

Every agent process registers its own Home Assistant device. By default the
instance id is ephemeral per process (`hostname-pid-random`), so concurrent
agents — on one machine or many — never share topics or MQTT clientIds and
never overwrite each other's state. This works with any number of supervisor
machines: no coordination, no shared locks, no single-PC assumption.

The tradeoff is device churn: every session leaves a retained discovery
config behind. Dead sessions report `offline` via Last Will and Testament,
so they grey out as `unavailable` — they do not send phantom state. Two
mechanisms keep the list manageable (see Dashboards and Cleanup below):

- Show only live agents with
  [lovelace-auto-entities](https://github.com/thomasloven/lovelace-auto-entities),
  filtered on availability.
- Periodically delete stale discovery configs (retained MQTT cleanup job).

Set `mqtt.instance_id` (or `PI_AGENT_MQTT_INSTANCE_ID`) only when you want a
stable persistent device instead — e.g. one long-lived box per systemd unit
or container. All sessions sharing that id share one device
(last-writer-wins on state), so only do this when a single agent owns the id.

```json
{
  "mqtt": {
    "will_delay_seconds": 90,
    "holder": "my-project",
    "expose": { "holder": true }
  }
}
```

`will_delay_seconds` (default 90, MQTT 5 only, `0` disables) holds the LWT
`offline` back so short sleeps and lid-closes do not flap sessions to
`unavailable`. Graceful shutdown still publishes `offline` immediately.

`holder` (or `PI_AGENT_MQTT_HOLDER`) labels what the session works on —
typically the project name. It shows in its own sensor so dynamic lists can
render it without parsing device names.

## Configuration

The plugin reads configuration from Pi settings files and environment variables.
Environment variables override file settings.

### Settings File (Recommended)

Add an `mqtt` key to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project).
Project settings override global settings — same pattern as `pi-ding`.

Global example (`~/.pi/agent/settings.json`) — uncommented values are the
defaults; commented lines show common non-default overrides:

```json
{
  "mqtt": {
    // "broker": "mqtt://192.168.1.50:1883", // default: mqtt://127.0.0.1:1883
    // "username": "pi-agent", // default: unset (anonymous)
    // "password_env": "PI_AGENT_MQTT_PASSWORD", // default: unset
    // "device_name": "Pi Agent on Workstation", // default: Pi Agent on <hostname>
    "discovery_prefix": "homeassistant",
    "qos": 1,
    "retain_state": true,
    "publish_interval_seconds": 5,
    "controls": { "stop": false },
    "expose": {
      "session": true,
      "model": true,
      "holder": true,
      "tool": true,
      "token_usage": true,
      "errors": true,
      "context_percent": true
    },
    "will_delay_seconds": 90
  }
}
```

Project override (`.pi/settings.json`) — only set what differs:

```json
{
  "mqtt": {
    "broker": "mqtt://192.168.1.10:1883"
  }
}
```

Set `instance_id` only when you want a stable persistent Home Assistant device.
By default the instance id is ephemeral per process (`hostname-pid-random`).
This avoids MQTT clientId / topic collisions when you run multiple agents that
share the same `~/.pi` dir. To pin an identity, set `PI_AGENT_MQTT_INSTANCE_ID`
or `mqtt.instance_id` in settings (e.g. per systemd unit or docker env).

Legacy files `.pi/mqtt.json` and `~/.pi/agent/mqtt.json` still work but are
deprecated — migrate their contents under the `mqtt` key in `settings.json`.

Only non-obvious defaults, not shown in the example above:

| Key | Default | Notes |
| --- | --- | --- |
| `instance_id` | `hostname-pid-random` | Ephemeral per process; set to pin a stable device |
| `holder` | unset | Holder sensor reads `free` when unset |
| `device_name` | `Pi Agent on <hostname>` | |
| `base_topic` | `pi-agent/<instance_id>` | |

### Dashboards: show only live agents

Entity ids are per-session, so pinning cards does not work. Use
[lovelace-auto-entities](https://github.com/thomasloven/lovelace-auto-entities)
to render whatever is currently alive. Dead sessions are `unavailable`
(LWT), so excluding them hides everything that is gone:

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

Entity ids follow `sensor.pi_agent_<instance>_status` where `<instance>` is
the instance id with non-alphanumerics replaced by `_`. A second card on
`sensor.pi_agent_*_holder` shows what each live session works on.

### Cleanup: delete stale discovery configs

Discovery configs are retained, so finished sessions stay registered (greyed
out) until their configs are deleted. Graceful exits do not delete them —
only `/mqtt-clean` from a live session, or an external job, does. Set up a
recurring cleanup, e.g. a cron job that publishes empty retained payloads to
`homeassistant/+/+/<node>/*/config` topics whose `availability` has been
`offline` for N days. Sketch with mosquitto tools:

```bash
# List discovery configs whose availability topic holds a retained "offline":
mosquitto_sub -h "$BROKER" -t 'pi-agent/+/availability' --retained-only -v 
```

Match each stale `pi-agent/<node>/availability` back to its discovery topics
`<prefix>/{sensor,binary_sensor,button}/<sanitized-node>/*/config` (sanitize
by replacing `[^a-zA-Z0-9_-]` with `_`) and clear them:

```bash
mosquitto_pub -h "$BROKER" -t "$CONFIG_TOPIC" -n -r
```

Until the job runs, stale devices are harmless: `unavailable`, excluded from
auto-entities lists, and they never trigger `working → idle` automations.

### Environment Variables

| Variable | Description |
| --- | --- |
| `PI_AGENT_MQTT_BROKER` | URL of the MQTT broker |
| `PI_AGENT_MQTT_USERNAME` | Username for MQTT authentication |
| `PI_AGENT_MQTT_PASSWORD` | Password for MQTT authentication |
| `PI_AGENT_MQTT_PASSWORD_ENV` | Name of environment variable with password |
| `PI_AGENT_MQTT_INSTANCE_ID` | Stable identifier for the agent instance |
| `PI_AGENT_MQTT_HOLDER` | Label of what this session works on (e.g. project name) |
| `PI_AGENT_MQTT_WILL_DELAY_SECONDS` | MQTT 5 LWT delay in seconds (default `90`, `0` disables) |
| `PI_AGENT_MQTT_DEVICE_NAME` | Display name of the Home Assistant device |
| `PI_AGENT_MQTT_BASE_TOPIC` | Base topic for state and availability |
| `PI_AGENT_MQTT_DISCOVERY_PREFIX` | Home Assistant discovery prefix |
| `PI_AGENT_MQTT_ENABLE_STOP` | Set to `true` to enable stop button |

## Commands

- `/mqtt` — info / reload / edit settings (`/mqtt edit` or `/mqtt edit global`)
- `/mqtt-status` — show connection state and published metrics
- `/mqtt-clean` — delete discovery entities from Home Assistant

## Home Assistant Automation Examples

### Notify when input is required

```yaml
alias: Pi Agent Waiting
triggers:
  - trigger: state
    entity_id: sensor.pi_agent_workstation_pi_status
    to: "waiting"
actions:
  - action: notify.notify
    data:
      title: "Pi Agent"
      message: "Pi Agent waits for user input."
mode: single
```

### Notify when task completes

Gate on availability implicitly: dead sessions go `unavailable`, never
`idle`, so only a live agent finishing triggers this. Closing the lid does
not fire your LEDs or sound.

```yaml
alias: Pi Agent Finished
triggers:
  - trigger: state
    entity_id: sensor.pi_agent_workstation_pi_status
    from:
      - "working"
      - "tool"
    to: "idle"
actions:
  - action: notify.notify
    data:
      title: "Pi Agent"
      message: "Pi Agent completed the task."
mode: single
```

With per-session entity ids, prefer an auto-entities card over per-device
automations when you want "any agent finished" across all live sessions.
