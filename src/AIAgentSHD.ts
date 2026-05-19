import { EventEmitter } from 'node:events';
import { HttpProvider, ToolSchema } from './HttpProvider.js';

export interface AgentConfig {
    tools: ToolSchema[];
    baseURL: string;
    apiKey: string;
    modelName: string;
    extraParams?: any;
    maxHistory?: number;
}

export class AIAgentSHD extends EventEmitter {
    private tools: ToolSchema[];
    private provider: HttpProvider;
    private isRunning: boolean = false;
    private memory: any[] = [];
    private maxHistory: number;

    constructor(config: AgentConfig) {
        super();
        this.tools = config.tools;
        this.provider = new HttpProvider(config.baseURL, config.apiKey, config.modelName, config.extraParams);
        this.maxHistory = config.maxHistory || 15; 
    }

    public reloadTools(newTools: ToolSchema[]) {
        this.tools = newTools;
    }

    public loadMemory(history: any[]) {
        this.memory = history;
    }

    public getMemory(): any[] {
        return this.memory;
    }

    public async startTask(prompt: string) {
        this.isRunning = true;
        this.memory.push({ role: 'user', content: prompt });
        this.emit('TASK_STARTED', { prompt });
        this.runLoop();
    }

    private async runLoop() {
        if (!this.isRunning) return;

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
            } else if (decision.action === "complete" || decision.result) {
                this.completeTask(decision.result || JSON.stringify(decision));
            } else {
                 this.completeTask(JSON.stringify(decision));
            }
        } catch (error: any) {
            this.emit('TASK_FAILED', { error: error.message });
            this.isRunning = false;
        }
    }

    public async resolveToolCall(callId: string, result: string) {
        this.emit('TOOL_CALL_RESOLVED', { callId, result });
        this.memory.push({ role: 'user', content: `System Observation for ${callId}: ${result}` });
        this.runLoop(); 
    }

    private completeTask(finalOutput: string) {
        this.memory.push({ role: 'assistant', content: finalOutput });
        this.emit('TASK_COMPLETED', { finalOutput });
        this.isRunning = false;
    }
}
