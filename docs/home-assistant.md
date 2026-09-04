# Home Assistant Setup

Dashboards, cleanup, labels, and automations for Pi Agent devices.

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

## Auto-cleanup setup

NOTE: The following doesn't apply to users who do not pin instance id (with PI_AGENT_MQTT_INSTANCE_ID).
If you do not use instance id pinning, this plugin will be creating a new MQTT device every time starting new Pi session.
(Either way can make sense, depending on your requirements).

Finished sessions stay registered until their retained discovery configs are deleted.
This deletion doesn't happen automatically, but you can set up automation for this.
Run a recurring job: find `pi-agent/<node>/availability` topics holding retained
`offline`, map each back to
`<prefix>/{sensor,binary_sensor,button}/<sanitized-node>/*/config`
(`[^a-zA-Z0-9_-]` → `_`), and clear them with empty retained publishes:

```bash
mosquitto_sub -h "$BROKER" -t 'pi-agent/+/availability' --retained-only -v
mosquitto_pub -h "$BROKER" -t "$CONFIG_TOPIC" -n -r
```

Until pruned, stale devices are harmless: `unavailable`, hidden from the
dashboard above, and never triggering `working → idle` automations.

## Labels

MQTT discovery cannot set labels, but an automation can tag each new device.

> `homeassistant.add_label_to_device` is not built into Home Assistant.
> It is provided by [Spook](https://spook.boo) (HACS custom integration).
> `unknown action: homeassistant.add_label_to_device` means Spook is
> missing, disabled, or failed to load. Fix Spook, do not just delete
> the action (removing Spook removes the action again).

### Prerequisites

1. Install [HACS](https://hacs.xyz/docs/use/) if needed.
2. In HACS, install **Spook**, then restart Home Assistant.
3. Go to Settings → Devices & Services → Add Integration → **Spook**.
   Confirm its entry is enabled (not ignored or disabled).
4. Go to Settings → Labels → create a label named exactly `Pi Agent`.
5. Verify before you create the automation: Developer Tools → Actions →
   search for `homeassistant.add_label_to_device`. If it is missing,
   Spook did not load. Check Settings → System → Logs for `spook`
   errors and confirm your Spook version supports your HA version.

Only then create the automation below:

```yaml
alias: Label new Pi Agent devices
triggers:
  - trigger: event
    event_type: device_registry_updated
    event_data:
      action: create
conditions:
  - condition: template
    value_template: >
      {{ 'pi-agent:' in (trigger.event.data.device_id
         | device_attr('identifiers') | join(',')) }}
actions:
  - action: homeassistant.add_label_to_device
    data:
      device_id: "{{ trigger.event.data.device_id }}"
      label_id: "{{ label_id('Pi Agent') }}"
mode: parallel
```

If the automation already exists and reports `unknown action`:

1. Do not delete the action. That repair warning is generic text.
2. Re-install or re-enable Spook (steps 2-3 above), then restart HA.
3. Re-check Developer Tools → Actions for the action name.
4. Reload automations: Developer Tools → YAML → Automations → Reload.
   The repair warning clears once the action exists again.

## Automations

Add via Settings → Automations & scenes → Create automation → ⋮ (top
right) → Edit in YAML → paste → Save.

Dead sessions go `unavailable`, never `idle`, so completion automations only
fire for live agents. Closing the lid triggers nothing. Requires the "Pi
Agent" label above: the trigger watches all Status sensors with that label
at once, and the notification names the device that finished:

```yaml
alias: Pi Agent Finished
triggers:
  - trigger: state
    entities:
      - label_id('Pi Agent')
    from: ["working", "tool"]
    to: "idle"
actions:
  - action: notify.notify
    data:
      title: "Pi Agent"
      message: "{{ trigger.to_state.name }} completed the task."
mode: single
```
