export interface ToolSchema {
    name: string;
    description: string;
    parameters: any;
}
export declare class HttpProvider {
    private baseURL;
    private apiKey;
    private model;
    private extraParams;
    constructor(baseURL: string, apiKey: string, model: string, extraParams?: any);
    generateDecision(messages: any[], tools: ToolSchema[]): Promise<any>;
}
