export declare class MCPManager {
    private client;
    private transport;
    private command;
    private args;
    constructor(command: string, args: string[]);
    connect(): Promise<void>;
    getTools(): Promise<any[]>;
    executeTool(name: string, args: any): Promise<string>;
}
