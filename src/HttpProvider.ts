export interface ToolSchema {
    name: string;
    description: string;
    parameters: any;
}

export class HttpProvider {
    private baseURL: string;
    private apiKey: string;
    private model: string;
    private extraParams: any;

    constructor(baseURL: string, apiKey: string, model: string, extraParams: any = {}) {
        this.baseURL = baseURL;
        this.apiKey = apiKey;
        this.model = model;
        this.extraParams = extraParams;
    }

    async generateDecision(messages: any[], tools: ToolSchema[]) {
        const systemPrompt = `You are an autonomous AI Agent.
Available tools:
${JSON.stringify(tools, null, 2)}

If you need to use a tool to progress, respond with RAW JSON:
{"action": "tool_call", "tool": "tool_name", "args": {"key": "value"}}

If you do not need a tool, or the final goal is met, respond with RAW JSON:
{"action": "complete", "result": "Your final response to the user"}

DO NOT wrap JSON in markdown formatting. DO NOT include any extra text or tokens.`;

        const payload = {
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                ...messages
            ],
            stream: false,
            ...this.extraParams
        };

        const requestHeaders: any = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        };

        if (this.apiKey && this.apiKey.trim() !== "") {
            requestHeaders["Authorization"] = `Bearer ${this.apiKey}`;
        }

        let attempts = 3;
        let response;
        
        while (attempts > 0) {
            response = await fetch(this.baseURL, {
                method: "POST",
                headers: requestHeaders,
                body: JSON.stringify(payload)
            });

            if (response.ok) break;

            if (response.status === 503 || response.status === 429) {
                attempts--;
                console.log(`\n\x1b[33m[Network] API overloaded (HTTP ${response.status}). Retrying in 3 seconds... (${attempts} attempts left)\x1b[0m`);
                if (attempts === 0) throw new Error(`HTTP Error ${response.status}: ${await response.text()}`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                throw new Error(`HTTP Error ${response.status}: ${await response.text()}`);
            }
        }

        // TYPE GUARD: Satisfies TypeScript strict mode by explicitly guaranteeing 'response' exists
        if (!response) {
            throw new Error("Network request failed to initialize.");
        }

        const data = await response.json();
        const textOutput = data.choices[0].message.content.trim();

        try {
            const start = textOutput.indexOf('{');
            const end = textOutput.lastIndexOf('}');
            
            if (start !== -1 && end !== -1) {
                const cleanJson = textOutput.substring(start, end + 1);
                const parsed = JSON.parse(cleanJson);
                return parsed;
            }
            throw new Error("No JSON bracket found");
        } catch (e) {
            return { action: "complete", result: textOutput };
        }
    }
}
