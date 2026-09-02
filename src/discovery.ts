import type {
  DiscoveryMessage,
  HomeAssistantBinarySensorDiscovery,
  HomeAssistantButtonDiscovery,
  HomeAssistantDevice,
  HomeAssistantSensorDiscovery,
  MqttPluginConfig,
} from "./types.js";

export function sanitizeNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function sanitizeUniqueId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

export function buildDevicePayload(config: MqttPluginConfig): HomeAssistantDevice {
  return {
    identifiers: [`pi-agent:${config.instance_id}`],
    name: config.device_name,
    manufacturer: "Pi",
    model: "Pi Agent",
    sw_version: "1.0.0",
  };
}

export function buildDiscoveryMessages(config: MqttPluginConfig): DiscoveryMessage[] {
  const nodeId = sanitizeNodeId(config.instance_id);
  const uniquePrefix = sanitizeUniqueId(config.instance_id);
  const device = buildDevicePayload(config);
  const availabilityTopic = `${config.base_topic}/availability`;
  const stateTopic = `${config.base_topic}/state`;
  const commandTopic = `${config.base_topic}/command`;

  const messages: DiscoveryMessage[] = [];

  // 1. Status Sensor
  const statusPayload: HomeAssistantSensorDiscovery = {
    name: "Status",
    unique_id: `pi_agent_${uniquePrefix}_status`,
    state_topic: stateTopic,
    value_template: "{{ value_json.status }}",
    availability_topic: availabilityTopic,
    payload_available: "online",
    payload_not_available: "offline",
    icon: "mdi:robot",
    device,
  };
  messages.push({
    topic: `${config.discovery_prefix}/sensor/${nodeId}/status/config`,
    payload: JSON.stringify(statusPayload),
    retain: true,
    qos: config.qos,
  });

  // 2. Busy Binary Sensor
  const busyPayload: HomeAssistantBinarySensorDiscovery = {
    name: "Busy",
    unique_id: `pi_agent_${uniquePrefix}_busy`,
    state_topic: stateTopic,
    value_template: "{{ 'ON' if value_json.busy else 'OFF' }}",
    payload_on: "ON",
    payload_off: "OFF",
    availability_topic: availabilityTopic,
    payload_available: "online",
    payload_not_available: "offline",
    device_class: "running",
    device,
  };
  messages.push({
    topic: `${config.discovery_prefix}/binary_sensor/${nodeId}/busy/config`,
    payload: JSON.stringify(busyPayload),
    retain: true,
    qos: config.qos,
  });

  // 3. Session Sensor (if enabled)
  if (config.expose.session !== false) {
    const sessionPayload: HomeAssistantSensorDiscovery = {
      name: "Session",
      unique_id: `pi_agent_${uniquePrefix}_session`,
      state_topic: stateTopic,
      value_template: "{{ value_json.session | default('none') }}",
      availability_topic: availabilityTopic,
      payload_available: "online",
      payload_not_available: "offline",
      icon: "mdi:message-processing",
      device,
    };
    messages.push({
      topic: `${config.discovery_prefix}/sensor/${nodeId}/session/config`,
      payload: JSON.stringify(sessionPayload),
      retain: true,
      qos: config.qos,
    });
  }

  // 4. Model Sensor (if enabled)
  if (config.expose.model !== false) {
    const modelPayload: HomeAssistantSensorDiscovery = {
      name: "Model",
      unique_id: `pi_agent_${uniquePrefix}_model`,
      state_topic: stateTopic,
      value_template: "{{ value_json.model | default('none') }}",
      availability_topic: availabilityTopic,
      payload_available: "online",
      payload_not_available: "offline",
      icon: "mdi:brain",
      device,
    };
    messages.push({
      topic: `${config.discovery_prefix}/sensor/${nodeId}/model/config`,
      payload: JSON.stringify(modelPayload),
      retain: true,
      qos: config.qos,
    });
  }

  // 5. Last Activity Sensor
  const lastActivityPayload: HomeAssistantSensorDiscovery = {
    name: "Last Activity",
    unique_id: `pi_agent_${uniquePrefix}_last_activity`,
    state_topic: stateTopic,
    value_template: "{{ value_json.last_activity }}",
    device_class: "timestamp",
    availability_topic: availabilityTopic,
    payload_available: "online",
    payload_not_available: "offline",
    device,
  };
  messages.push({
    topic: `${config.discovery_prefix}/sensor/${nodeId}/last_activity/config`,
    payload: JSON.stringify(lastActivityPayload),
    retain: true,
    qos: config.qos,
  });

  // 6. Stop Button (if enabled)
  if (config.controls.stop) {
    const stopPayload: HomeAssistantButtonDiscovery = {
      name: "Stop",
      unique_id: `pi_agent_${uniquePrefix}_stop`,
      command_topic: commandTopic,
      payload_press: JSON.stringify({ command: "stop" }),
      availability_topic: availabilityTopic,
      payload_available: "online",
      payload_not_available: "offline",
      icon: "mdi:stop-circle",
      device,
    };
    messages.push({
      topic: `${config.discovery_prefix}/button/${nodeId}/stop/config`,
      payload: JSON.stringify(stopPayload),
      retain: true,
      qos: config.qos,
    });
  }

  return messages;
}

export function buildCleanupMessages(config: MqttPluginConfig): DiscoveryMessage[] {
  const nodeId = sanitizeNodeId(config.instance_id);
  const entities = [
    { component: "sensor", name: "status" },
    { component: "binary_sensor", name: "busy" },
    { component: "sensor", name: "session" },
    { component: "sensor", name: "model" },
    { component: "sensor", name: "last_activity" },
    { component: "button", name: "stop" },
  ];

  return entities.map((e) => ({
    topic: `${config.discovery_prefix}/${e.component}/${nodeId}/${e.name}/config`,
    payload: "",
    retain: true,
    qos: config.qos,
  }));
}
