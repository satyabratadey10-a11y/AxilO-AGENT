export class MCPManager {
    private client: any;
    private transport: any;
    private command: string;
    private args: string[];

    constructor(command: string, args: string[]) {
        this.command = command;
        this.args = args;
    }

    public async connect(): Promise<void> {
        // Dynamic imports prevent strict CommonJS/ESM compilation crashes in Termux
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        
        this.transport = new StdioClientTransport({ command: this.command, args: this.args });
        
        // FIX: Clients do not declare 'tools' capabilities, only Servers do.
        this.client = new Client(
            { name: "turnai-mcp-client", version: "1.0.0" },
            { capabilities: {} } 
        );
        
        await this.client.connect(this.transport);
    }

    public async getTools(): Promise<any[]> {
        const response = await this.client.listTools();
        return response.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }));
    }

    public async executeTool(name: string, args: any): Promise<string> {
        const result = await this.client.callTool({ name, arguments: args });
        return result.content.map((c: any) => c.text).join('\n');
    }
}
