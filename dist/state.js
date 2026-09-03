export class StateManager {
    config;
    state;
    constructor(config) {
        this.config = config;
        this.state = {
            status: "idle",
            busy: false,
            session: null,
            model: null,
            holder: null,
            tool: null,
            last_activity: new Date().toISOString(),
            turn_count: 0,
            input_tokens: 0,
            output_tokens: 0,
            context_percent: 0,
            last_error: null,
        };
    }
    updateConfig(config) {
        this.config = config;
    }
    getRawState() {
        return { ...this.state };
    }
    setStatus(status) {
        this.state.status = status;
        this.state.busy = status === "working" || status === "tool" || status === "stopping";
        this.state.last_activity = new Date().toISOString();
    }
    setSession(session) {
        this.state.session = session;
        this.state.last_activity = new Date().toISOString();
    }
    setModel(model) {
        this.state.model = model;
        this.state.last_activity = new Date().toISOString();
    }
    setTool(tool) {
        this.state.tool = tool;
        if (tool) {
            this.state.status = "tool";
            this.state.busy = true;
        }
        this.state.last_activity = new Date().toISOString();
    }
    incrementTurn() {
        this.state.turn_count += 1;
        this.state.last_activity = new Date().toISOString();
    }
    setTurnCount(count) {
        this.state.turn_count = count;
        this.state.last_activity = new Date().toISOString();
    }
    setHolder(holder) {
        this.state.holder = holder;
        this.state.last_activity = new Date().toISOString();
    }
    updateTokens(inputTokens, outputTokens, contextPercent) {
        if (inputTokens !== undefined) {
            this.state.input_tokens = inputTokens;
        }
        if (outputTokens !== undefined) {
            this.state.output_tokens = outputTokens;
        }
        if (contextPercent !== undefined) {
            this.state.context_percent = contextPercent;
        }
        this.state.last_activity = new Date().toISOString();
    }
    setError(error) {
        this.state.last_error = error;
        if (error) {
            this.state.status = "error";
            this.state.busy = false;
        }
        this.state.last_activity = new Date().toISOString();
    }
    buildFilteredStatePayload() {
        const payload = {
            status: this.state.status,
            busy: this.state.busy,
            last_activity: this.state.last_activity,
            turn_count: this.state.turn_count,
        };
        if (this.config.expose.session !== false) {
            payload.session = this.state.session ?? "none";
        }
        if (this.config.expose.model !== false) {
            payload.model = this.state.model ?? "none";
        }
        if (this.config.expose.holder !== false) {
            payload.holder = this.state.holder ?? "free";
        }
        if (this.config.expose.tool !== false) {
            payload.tool = this.state.tool ?? null;
        }
        if (this.config.expose.token_usage !== false) {
            payload.input_tokens = this.state.input_tokens ?? 0;
            payload.output_tokens = this.state.output_tokens ?? 0;
        }
        if (this.config.expose.context_percent !== false && this.state.context_percent !== undefined) {
            payload.context_percent = this.state.context_percent;
        }
        if (this.config.expose.errors !== false) {
            payload.last_error = this.state.last_error ?? null;
        }
        return payload;
    }
}
