export type AgentStatus =
  | "idle"
  | "working"
  | "tool"
  | "waiting"
  | "error"
  | "stopping";

export interface MqttControlsConfig {
  stop?: boolean;
}

export interface MqttExposeConfig {
  session?: boolean;
  model?: boolean;
  project?: boolean;
  tool?: boolean;
  token_usage?: boolean;
  errors?: boolean;
  context_percent?: boolean;
}

export interface MqttPluginConfig {
  broker: string;
  username?: string;
  password?: string;
  password_env?: string;
  instance_id: string;
  /** Human-readable label of what this session works on (defaults to working directory name). */
  project?: string;
  /** MQTT 5 will-delay in seconds; LWT "offline" is held back this long. 0 disables. */
  will_delay_seconds: number;
  device_name: string;
  base_topic: string;
  discovery_prefix: string;
  qos: 0 | 1 | 2;
  retain_state: boolean;
  publish_interval_seconds: number;
  controls: MqttControlsConfig;
  expose: MqttExposeConfig;
}

export interface AgentStateData {
  status: AgentStatus;
  busy: boolean;
  session?: string | null;
  model?: string | null;
  project?: string | null;
  tool?: string | null;
  last_activity: string;
  turn_count: number;
  input_tokens?: number;
  output_tokens?: number;
  context_percent?: number;
  last_error?: string | null;
}

export interface HomeAssistantDevice {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
  sw_version?: string;
}

export interface HomeAssistantSensorDiscovery {
  name: string;
  unique_id: string;
  state_topic: string;
  value_template: string;
  availability_topic: string;
  payload_available: string;
  payload_not_available: string;
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  icon?: string;
  expire_after?: number;
  device: HomeAssistantDevice;
}

export interface HomeAssistantBinarySensorDiscovery {
  name: string;
  unique_id: string;
  state_topic: string;
  value_template: string;
  payload_on: string;
  payload_off: string;
  availability_topic: string;
  payload_available: string;
  payload_not_available: string;
  device_class?: string;
  icon?: string;
  expire_after?: number;
  device: HomeAssistantDevice;
}

export interface HomeAssistantButtonDiscovery {
  name: string;
  unique_id: string;
  command_topic: string;
  payload_press: string;
  availability_topic: string;
  payload_available: string;
  payload_not_available: string;
  icon?: string;
  device: HomeAssistantDevice;
}

export interface DiscoveryMessage {
  topic: string;
  payload: string;
  retain: boolean;
  qos: 0 | 1 | 2;
}

export interface IncomingCommandPayload {
  command?: string;
  action?: string;
}
