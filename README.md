# Pi Agent Home Assistant MQTT Plugin

## Description
This plugin connects Pi Agent to an MQTT broker.
The plugin publishes Home Assistant MQTT Discovery configuration.
The plugin publishes agent status and metadata.
Home Assistant creates entities automatically through MQTT Discovery.
No custom Home Assistant code is required.

## Features
- Automatic entity discovery in Home Assistant
- Device grouping under one Home Assistant device
- State updates for `idle`, `working`, `tool`, `waiting`, `error`, and `stopping`
- MQTT Last Will and Testament for availability detection
- Safe defaults without prompt or response leakage
- Multi-instance support with custom instance identifiers

## Entities

| Entity | Type | Description |
| --- | --- | --- |
| Status | Sensor | Reports current lifecycle state |
| Busy | Binary Sensor | Reports if agent runs an active task |
| Session | Sensor | Reports active session identifier |
| Model | Sensor | Reports active model identifier |
| Last Activity | Sensor | Reports timestamp of latest state change |
| Stop | Button | Optional control button to cancel current work |

## Installation

Install the package with the Pi package manager:

```bash
pi install npm:pi-home-assistant-mqtt
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

Set `instance_id` only when you want a stable persistent Home Assistant device.
By default the instance id is ephemeral per process (`hostname-pid-random`).
This avoids MQTT clientId / topic collisions when you run multiple agents that
share the same `~/.pi` dir. To pin an identity, set `PI_AGENT_MQTT_INSTANCE_ID`
or `mqtt.instance_id` in settings (e.g. per systemd unit or docker env).

Legacy files `.pi/mqtt.json` and `~/.pi/agent/mqtt.json` still work but are
deprecated — migrate their contents under the `mqtt` key in `settings.json`.

### Environment Variables

| Variable | Description |
| --- | --- |
| `PI_AGENT_MQTT_BROKER` | URL of the MQTT broker |
| `PI_AGENT_MQTT_USERNAME` | Username for MQTT authentication |
| `PI_AGENT_MQTT_PASSWORD` | Password for MQTT authentication |
| `PI_AGENT_MQTT_PASSWORD_ENV` | Name of environment variable with password |
| `PI_AGENT_MQTT_INSTANCE_ID` | Stable identifier for the agent instance |
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
