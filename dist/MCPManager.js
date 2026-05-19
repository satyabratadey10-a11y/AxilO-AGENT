"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPManager = void 0;
class MCPManager {
    client;
    transport;
    command;
    args;
    constructor(command, args) {
        this.command = command;
        this.args = args;
    }
    async connect() {
        // Dynamic imports prevent strict CommonJS/ESM compilation crashes in Termux
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        this.transport = new StdioClientTransport({ command: this.command, args: this.args });
        // FIX: Clients do not declare 'tools' capabilities, only Servers do.
        this.client = new Client({ name: "turnai-mcp-client", version: "1.0.0" }, { capabilities: {} });
        await this.client.connect(this.transport);
    }
    async getTools() {
        const response = await this.client.listTools();
        return response.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }));
    }
    async executeTool(name, args) {
        const result = await this.client.callTool({ name, arguments: args });
        return result.content.map((c) => c.text).join('\n');
    }
}
exports.MCPManager = MCPManager;
