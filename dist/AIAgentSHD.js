"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIAgentSHD = void 0;
const node_events_1 = require("node:events");
const HttpProvider_js_1 = require("./HttpProvider.js");
class AIAgentSHD extends node_events_1.EventEmitter {
    tools;
    provider;
    isRunning = false;
    memory = [];
    maxHistory;
    constructor(config) {
        super();
        this.tools = config.tools;
        this.provider = new HttpProvider_js_1.HttpProvider(config.baseURL, config.apiKey, config.modelName, config.extraParams);
        this.maxHistory = config.maxHistory || 15;
    }
    reloadTools(newTools) {
        this.tools = newTools;
    }
    loadMemory(history) {
        this.memory = history;
    }
    getMemory() {
        return this.memory;
    }
    async startTask(prompt) {
        this.isRunning = true;
        this.memory.push({ role: 'user', content: prompt });
        this.emit('TASK_STARTED', { prompt });
        this.runLoop();
    }
    async runLoop() {
        if (!this.isRunning)
            return;
        try {
            this.emit('STEP_COMPLETED', { message: 'Analyzing current state...' });
            let safeContext = this.memory;
            if (this.memory.length > this.maxHistory) {
                safeContext = this.memory.slice(-this.maxHistory);
            }
            const decision = await this.provider.generateDecision(safeContext, this.tools);
            if (decision.action === "tool_call" || (decision.tool && decision.args)) {
                const callId = `call_${Date.now()}`;
                const toolNameToCall = decision.tool || decision.action;
                // FIX: We must store the raw JSON string in memory, NOT plain text. 
                // This prevents the AI from forgetting its JSON formatting in long chats.
                this.memory.push({ role: 'assistant', content: JSON.stringify(decision) });
                this.emit('TOOL_CALL_REQUESTED', {
                    callId,
                    toolName: toolNameToCall,
                    args: decision.args
                });
            }
            else if (decision.action === "complete" || decision.result) {
                this.completeTask(decision.result || JSON.stringify(decision));
            }
            else {
                this.completeTask(JSON.stringify(decision));
            }
        }
        catch (error) {
            this.emit('TASK_FAILED', { error: error.message });
            this.isRunning = false;
        }
    }
    async resolveToolCall(callId, result) {
        this.emit('TOOL_CALL_RESOLVED', { callId, result });
        this.memory.push({ role: 'user', content: `System Observation for ${callId}: ${result}` });
        this.runLoop();
    }
    completeTask(finalOutput) {
        this.memory.push({ role: 'assistant', content: finalOutput });
        this.emit('TASK_COMPLETED', { finalOutput });
        this.isRunning = false;
    }
}
exports.AIAgentSHD = AIAgentSHD;
