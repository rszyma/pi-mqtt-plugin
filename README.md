# Pi Agent Home Assistant MQTT Plugin

## Description
This plugin connects Pi Agent to an MQTT broker.
The plugin publishes Home Assistant MQTT Discovery configuration.
The plugin publishes agent status and metadata.
Home Assistant creates entities automatically through MQTT Discovery.
No custom Home Assistant code is required.

## Features
- Automatic entity discovery in Home Assistant
- Fixed pool of slot devices (`hostname-1` … `hostname-N`) for stable dashboards
- State updates for `idle`, `working`, `tool`, `waiting`, `error`, and `stopping`
- MQTT Last Will and Testament for availability detection (with will-delay for sleep)
- Safe defaults without prompt or response leakage
- Host-side slot allocator (`bin/pi-slot`) so parallel VMs never share an identity

## Entities

| Entity | Type | Description |
| --- | --- | --- |
| Status | Sensor | Reports current lifecycle state |
| Busy | Binary Sensor | Reports if agent runs an active task |
| Session | Sensor | Reports active session identifier |
| Model | Sensor | Reports active model identifier |
| Holder | Sensor | Reports which project holds this slot (`free` when unset) |
| Last Activity | Sensor | Reports timestamp of latest state change |
| Stop | Button | Optional control button to cancel current work |

## Installation

Install the package with the Pi package manager:

```bash
pi install github:rszyma/pi-home-assistant-mqtt
```

## Configuration

The plugin reads configuration from Pi settings files and environment variables.
Environment variables override file settings.

### Settings File (Recommended)

Add an `mqtt` key to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project).
Project settings override global settings — same pattern as `pi-ding`.

Global example (`~/.pi/agent/settings.json`):

```json
{
  "mqtt": {
    "broker": "mqtt://192.168.1.50:1883",
    "username": "pi-agent",
    "password_env": "PI_AGENT_MQTT_PASSWORD",
    "device_name": "Pi Agent on Workstation",
    "discovery_prefix": "homeassistant",
    "qos": 1,
    "retain_state": true,
    "publish_interval_seconds": 5,
    "controls": { "stop": false },
    "expose": {
      "session": true,
      "model": true,
      "tool": true,
      "token_usage": true,
      "errors": true
    }
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

Set `instance_id` only when you need a fully custom identity (it overrides
the hostname default). Normally you do not set the identity at all: the
`pi-slot` launcher helper on the host claims a slot and passes
`PI_AGENT_MQTT_INSTANCE_SUFFIX=N`, which gives `vm-opencode-N`.
The default is the sanitized hostname, stable across restarts, so sequential
sessions reuse one Home Assistant device. MQTT clientIds still get a
per-process pid suffix so concurrent agents never evict each other from
the broker.

```json
{
  "mqtt": {
    "slot_count": 4,
    "will_delay_seconds": 90,
    "holder": "my-project",
    "expose": { "holder": true }
  }
}
```

`slot_count` (default 4) sizes the pool. A numeric suffix beyond the pool
without a full `instance_id` override is a fail-loud overflow: the agent
logs an error and does not connect MQTT, so a 5th agent never silently
invents a new device.

`will_delay_seconds` (default 90, MQTT 5 only, 0 disables) holds the LWT
`offline` back so short sleeps and lid-closes do not flap every slot.
Graceful shutdown still publishes `offline` immediately.

`holder` (or `PI_AGENT_MQTT_HOLDER`) labels what holds the slot — typically
the project name, set by the launcher. The device name stays stable
(`Pi Agent on vm-opencode-1`); the holder shows in its own sensor.

### Slot allocation with `pi-slot` (host side)

Slot allocation happens on the host, never inside the guest VM and never
over MQTT. The launcher claims a slot on the host filesystem and passes
the suffix in:

```bash
# Run a VM with an auto-claimed slot (suffix exported into the VM env)
bin/pi-slot --holder my-project -- qemu-system-x86_64 ...

# Inspect slots
bin/pi-slot --list

# Advanced: claim and hold manually (prints N, holds until killed)
bin/pi-slot --claim
```

Options: `--slots N` (pool size), `--dir DIR` (lock dir),
`--on-overflow fail|wait` (block instead of refusing). Locks are host
processes, so PC sleep never frees them and killing the VM frees its slot.
The guest only sees `PI_AGENT_MQTT_INSTANCE_SUFFIX`.

### Limitation: single launching PC

This design assumes **one PC launches all agent VMs**. Slot locks live on
that PC's filesystem and MQTT presence is only a reporting signal, never
the allocator. Two PCs allocating from the same pool will collide: both
can claim "slot 1" locally and fight over one Home Assistant device
(last-writer-wins on state). If you ever add a second launching host,
give each host its own pool (different `slot_count` ranges are not
enough — use distinct `instance_id` prefixes per host) or move allocation
to a shared arbiter.

Legacy files `.pi/mqtt.json` and `~/.pi/agent/mqtt.json` still work but are
deprecated — migrate their contents under the `mqtt` key in `settings.json`.

### Environment Variables

| Variable | Description |
| --- | --- |
| `PI_AGENT_MQTT_BROKER` | URL of the MQTT broker |
| `PI_AGENT_MQTT_USERNAME` | Username for MQTT authentication |
| `PI_AGENT_MQTT_PASSWORD` | Password for MQTT authentication |
| `PI_AGENT_MQTT_PASSWORD_ENV` | Name of environment variable with password |
| `PI_AGENT_MQTT_INSTANCE_ID` | Full override for the agent instance id |
| `PI_AGENT_MQTT_INSTANCE_SUFFIX` | Suffix appended to hostname id (e.g. `1`, `2`) |
| `PI_AGENT_MQTT_HOLDER` | Label of what holds this slot (e.g. project name) |
| `PI_AGENT_MQTT_SLOT_COUNT` | Pool size for numeric-slot overflow check (default `4`) |
| `PI_AGENT_MQTT_WILL_DELAY_SECONDS` | MQTT 5 LWT delay in seconds (default `90`, `0` disables) |
| `PI_AGENT_MQTT_SLOT_DIR` | Lock dir for `pi-slot` (default `~/.cache/pi-slots`) |
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

Gate on availability: sleep and kills surface as `unavailable`, never as
`idle`, so closing the lid does not trigger LEDs or sound.

```yaml
alias: Pi Agent Finished
triggers:
  - trigger: state
    entity_id: sensor.pi_agent_vm_opencode_1_status
    from:
      - "working"
      - "tool"
    to: "idle"
conditions:
  - condition: not
    conditions:
      - condition: state
        entity_id: sensor.pi_agent_vm_opencode_1_status
        state: unavailable
actions:
  - action: notify.notify
    data:
      title: "Pi Agent"
      message: "Pi Agent completed the task."
mode: single
```

Replace `vm_opencode_1` with your slot entity. Entity ids follow
`sensor.pi_agent_<instance>_status` where `<instance>` is the instance id
with non-alphanumerics replaced by `_`. With fixed slots 1-4 you can also
template across all four status entities for "any agent finished" and
count running agents.
