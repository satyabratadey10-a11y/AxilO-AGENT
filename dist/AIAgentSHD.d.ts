import { EventEmitter } from 'node:events';
import { ToolSchema } from './HttpProvider.js';
export interface AgentConfig {
    tools: ToolSchema[];
    baseURL: string;
    apiKey: string;
    modelName: string;
    extraParams?: any;
    maxHistory?: number;
}
export declare class AIAgentSHD extends EventEmitter {
    private tools;
    private provider;
    private isRunning;
    private memory;
    private maxHistory;
    constructor(config: AgentConfig);
    reloadTools(newTools: ToolSchema[]): void;
    loadMemory(history: any[]): void;
    getMemory(): any[];
    startTask(prompt: string): Promise<void>;
    private runLoop;
    resolveToolCall(callId: string, result: string): Promise<void>;
    private completeTask;
}
