/**
 * Universal API Gateway Connection Module for AxilO Agent
 * Supports: AgentRouter (with full Claude-Code whitelisting), OpenAI, Anthropic, Gemini, Grok, HuggingFace
 */

const crypto = require('crypto');

// Initialize 60s connect timeout via Undici if available
try {
    const undiciPath = '/data/data/com.termux/files/usr/lib/node_modules/npm/node_modules/undici';
    const { Agent, setGlobalDispatcher } = require(undiciPath);
    setGlobalDispatcher(new Agent({ connect: { timeout: 60000 } }));
} catch (e) {
    // Fall back to default global fetch dispatcher
}

function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function capTools(toolList, max = 128) {
    if (!toolList || !Array.isArray(toolList)) return [];
    return toolList.slice(0, max);
}

/**
 * Main AI Gateway Call
 * @param {Object} options
 * @param {Object} options.activeModel - Model configuration
 * @param {Array} options.chatHistory - Multi-turn message history
 * @param {string} options.promptText - Current prompt
 * @param {string} options.SYSTEM_PROMPT - System instruction
 * @param {Array} options.tools - Available tools array
 * @param {Function} options.onToken - Callback for streaming tokens (chunk: string)
 * @param {AbortSignal} options.signal - Abort signal
 */
async function callAI({ activeModel, chatHistory = [], promptText, SYSTEM_PROMPT, tools = [], onToken = null, signal = null }) {
    let provider = (activeModel.provider || '').toLowerCase();
    const endpoint = activeModel.endpoint || '';

    if (!provider) {
        if (endpoint.includes('agentrouter.org')) {
            provider = 'agentrouter';
        } else if (endpoint.includes('generativelanguage.googleapis.com')) {
            provider = 'google';
        } else if (endpoint.includes('api.anthropic.com')) {
            provider = 'anthropic';
        } else if (endpoint.includes('api.x.ai')) {
            provider = 'grok';
        } else if (endpoint.includes('huggingface.co')) {
            provider = 'huggingface';
        } else {
            provider = 'openai';
        }
    }

    const fullHistory = promptText ? [...chatHistory, { role: 'user', content: promptText }] : [...chatHistory];
    const cappedTools = capTools(tools, 128);

    // =========================================================================
    // 1. AGENTROUTER & ANTHROPIC NATIVE PATHWAY (MESSAGES API)
    // =========================================================================
    if (provider === 'agentrouter' || provider === 'anthropic') {
        const isAgentRouter = provider === 'agentrouter' || endpoint.includes('agentrouter.org');
        let baseUrl = endpoint.replace(/\/v1\/messages.*$/, '').replace(/\/+$/, '');
        if (!baseUrl) baseUrl = isAgentRouter ? 'https://agentrouter.org' : 'https://api.anthropic.com';
        const url = `${baseUrl}/v1/messages`;

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': activeModel.apiKey
        };

        if (isAgentRouter) {
            headers['user-agent'] = 'claude-cli/2.1.112 (external, sdk-cli)';
            headers['x-app'] = 'cli';
            headers['x-claude-code-session-id'] = generateUUID();
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
            headers['x-stainless-arch'] = 'arm64';
            headers['x-stainless-lang'] = 'js';
            headers['x-stainless-os'] = 'Android';
            headers['x-stainless-package-version'] = '0.81.0';
            headers['x-stainless-retry-count'] = '0';
            headers['x-stainless-runtime'] = 'node';
            headers['x-stainless-runtime-version'] = 'v26.2.0';
            headers['x-stainless-timeout'] = '600';
        }

        // Convert messages to Anthropic format
        const anthropicMessages = [];
        let lastRole = null;

        for (const msg of fullHistory) {
            if (msg.role === 'system') continue;
            let currentRole = msg.role === 'assistant' || msg.role === 'ai' ? 'assistant' : 'user';

            let contentBlock = msg.content;
            if (typeof contentBlock === 'string') {
                contentBlock = [{ type: 'text', text: contentBlock }];
            } else if (!Array.isArray(contentBlock)) {
                contentBlock = [{ type: 'text', text: JSON.stringify(contentBlock) }];
            }

            // Append tool calls or tool results if present
            if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                msg.tool_calls.forEach(tc => {
                    contentBlock.push({
                        type: 'tool_use',
                        id: tc.id || `call_${Math.random().toString(36).substring(2, 9)}`,
                        name: tc.name,
                        input: typeof tc.args === 'string' ? JSON.parse(tc.args) : (tc.args || {})
                    });
                });
            }

            if (msg.tool_call_id) {
                currentRole = 'user';
                contentBlock = [{
                    type: 'tool_result',
                    tool_use_id: msg.tool_call_id,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                }];
            }

            if (currentRole === lastRole && anthropicMessages.length > 0) {
                anthropicMessages[anthropicMessages.length - 1].content.push(...contentBlock);
            } else {
                anthropicMessages.push({ role: currentRole, content: contentBlock });
                lastRole = currentRole;
            }
        }

        if (anthropicMessages.length === 0) {
            anthropicMessages.push({ role: 'user', content: [{ type: 'text', text: promptText || 'Hello' }] });
        }

        // Map tools to Anthropic schema
        const anthropicTools = cappedTools.map(t => ({
            name: t.name,
            description: t.description || '',
            input_schema: t.parameters || { type: 'object', properties: {} }
        }));

        const body = {
            model: activeModel.id,
            max_tokens: activeModel.maxTokens || 4096,
            messages: anthropicMessages,
            system: SYSTEM_PROMPT || "You are AxilO, a senior autonomous AI assistant.",
            stream: !!activeModel.stream
        };

        // CRITICAL: Do NOT send temperature to AgentRouter or reasoning models when tools are present!
        if (!isAgentRouter && activeModel.temperature !== undefined) {
            body.temperature = activeModel.temperature;
        }

        if (anthropicTools.length > 0) {
            body.tools = anthropicTools;
        }

        // Note: NEVER send reasoning_effort or thinking when tools are included to prevent OpenAI 400 rejection

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API ${response.status}: ${errText}`);
        }

        if (activeModel.stream && response.body) {
            let fullText = '';
            const toolCalls = [];
            let currentToolCall = null;
            let currentArgString = '';

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete trailing line

                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (!cleanLine.startsWith('data:')) continue;
                    const rawData = cleanLine.slice(5).trim();
                    if (rawData === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(rawData);

                        // 1. Text delta
                        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                            fullText += parsed.delta.text;
                            if (onToken) onToken(parsed.delta.text);
                        }

                        // 2. Tool use start
                        if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                            currentToolCall = {
                                id: parsed.content_block.id,
                                name: parsed.content_block.name,
                                args: {}
                            };
                            currentArgString = '';
                        }

                        // 3. Tool use argument delta
                        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
                            currentArgString += parsed.delta.partial_json || '';
                        }

                        // 4. Content block stop
                        if (parsed.type === 'content_block_stop' && currentToolCall) {
                            try {
                                currentToolCall.args = JSON.parse(currentArgString || '{}');
                            } catch (e) {
                                currentToolCall.args = { raw: currentArgString };
                            }
                            toolCalls.push(currentToolCall);
                            currentToolCall = null;
                            currentArgString = '';
                        }
                    } catch (e) {}
                }
            }

            return { text: fullText, toolCalls, raw: null };
        } else {
            const json = await response.json();
            let fullText = '';
            const toolCalls = [];

            if (json.content && Array.isArray(json.content)) {
                for (const block of json.content) {
                    if (block.type === 'text') fullText += block.text;
                    if (block.type === 'tool_use') {
                        toolCalls.push({
                            id: block.id,
                            name: block.name,
                            args: block.input || {}
                        });
                    }
                }
            }

            if (onToken && fullText) onToken(fullText);
            return { text: fullText, toolCalls, raw: json };
        }
    }

    // =========================================================================
    // 2. OPENAI NATIVE & COMPATIBLE PATHWAY
    // =========================================================================
    if (provider === 'openai' || provider === 'grok') {
        let cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        if (!cleanEndpoint) cleanEndpoint = 'https://api.openai.com/v1';
        if (!cleanEndpoint.includes('/chat/completions')) cleanEndpoint = `${cleanEndpoint}/chat/completions`;

        const messages = [{ role: 'system', content: SYSTEM_PROMPT || "You are AxilO, a senior autonomous AI assistant." }];

        for (const msg of fullHistory) {
            let role = msg.role === 'ai' || msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : msg.role === 'tool' ? 'tool' : 'user';
            const m = { role };

            if (msg.content !== undefined && msg.content !== null) {
                m.content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            } else {
                m.content = null;
            }

            // Strictly format tool_calls for OpenAI standard specification
            if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                m.tool_calls = msg.tool_calls.map(tc => {
                    let argStr = '{}';
                    if (tc.function && typeof tc.function.arguments === 'string') {
                        argStr = tc.function.arguments;
                    } else if (tc.args !== undefined) {
                        argStr = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {});
                    } else if (tc.function?.arguments) {
                        argStr = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
                    }
                    return {
                        id: tc.id || `call_${Math.random().toString(36).substring(2, 9)}`,
                        type: 'function',
                        function: {
                            name: tc.name || tc.function?.name || 'tool',
                            arguments: argStr
                        }
                    };
                });
                if (!m.content) {
                    m.content = null;
                }
            }

            // Strictly format tool results for OpenAI standard specification
            if (msg.role === 'tool' || msg.tool_call_id) {
                m.role = 'tool';
                m.tool_call_id = msg.tool_call_id;
                m.content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
            }

            messages.push(m);
        }

        // Map tools to OpenAI functions format
        const openAITools = cappedTools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description || '',
                parameters: t.parameters || { type: 'object', properties: {} }
            }
        }));

        const body = {
            model: activeModel.id,
            messages,
            temperature: activeModel.temperature !== undefined ? activeModel.temperature : 0.3,
            max_tokens: activeModel.maxTokens || 4096,
            stream: !!activeModel.stream
        };

        // Pass options (e.g. num_ctx) for Ollama / Colab OpenAI compatibility endpoint
        if (activeModel.options || activeModel.contextTokens || activeModel.num_ctx) {
            body.options = activeModel.options || {
                num_ctx: activeModel.contextTokens || activeModel.num_ctx || 32768
            };
        }

        if (openAITools.length > 0) {
            body.tools = openAITools;
            // CRITICAL: Omit reasoning_effort when tools are attached!
        }

        const response = await fetch(cleanEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${activeModel.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal
        });

        if (!response.ok) {
            let errText = await response.text();
            if (errText.includes('<html') || errText.includes('<!DOCTYPE') || errText.includes('<!doctype')) {
                if (response.status === 530 || errText.includes('1033') || errText.includes('Cloudflare Tunnel error')) {
                    errText = 'Cloudflare Tunnel Offline (HTTP 530 / Error 1033): The Google Colab GPU tunnel is temporarily unreachable. Run "python3 colab_daemon.py" or check Colab session.';
                } else if (response.status === 524) {
                    errText = 'Cloudflare Timeout (HTTP 524): The generation took longer than Cloudflare deadline (100s).';
                } else {
                    const titleMatch = errText.match(/<title>([^<]+)<\/title>/i);
                    errText = titleMatch ? titleMatch[1].trim() : `HTTP ${response.status} Server Error`;
                }
            }
            throw new Error(`OpenAI API ${response.status}: ${errText}`);
        }

        if (activeModel.stream && response.body) {
            let fullText = '';
            const toolCallsMap = {};

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (!cleanLine.startsWith('data:')) continue;
                    const rawData = cleanLine.slice(5).trim();
                    if (rawData === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(rawData);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;

                        const thinkingChunk = delta.reasoning || delta.reasoning_content || delta.thinking;
                        if (thinkingChunk) {
                            if (onToken) onToken(thinkingChunk, true);
                        }

                        if (delta.content) {
                            fullText += delta.content;
                            if (onToken) onToken(delta.content, false);
                        }

                        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index !== undefined ? tc.index : 0;
                                if (!toolCallsMap[idx]) {
                                    toolCallsMap[idx] = { id: tc.id || `call_${idx}`, name: tc.function?.name || '', argString: '' };
                                }
                                if (tc.function?.name) toolCallsMap[idx].name = tc.function.name;
                                if (tc.function?.arguments) toolCallsMap[idx].argString += tc.function.arguments;
                            }
                        }
                    } catch (e) {}
                }
            }

            const toolCalls = Object.values(toolCallsMap).map(t => {
                let args = {};
                try { args = JSON.parse(t.argString || '{}'); } catch(e) { args = { raw: t.argString }; }
                return { id: t.id, name: t.name, args };
            });

            return { text: fullText, toolCalls, raw: null };
        } else {
            const json = await response.json();
            const choice = json.choices?.[0]?.message;
            const fullText = choice?.content || '';
            const toolCalls = [];

            if (choice?.tool_calls && Array.isArray(choice.tool_calls)) {
                for (const tc of choice.tool_calls) {
                    let args = {};
                    try { args = JSON.parse(tc.function.arguments || '{}'); } catch(e) { args = { raw: tc.function.arguments }; }
                    toolCalls.push({ id: tc.id, name: tc.function.name, args });
                }
            }

            if (onToken && fullText) onToken(fullText);
            return { text: fullText, toolCalls, raw: json };
        }
    }

    // =========================================================================
    // 3. GOOGLE GEMINI NATIVE PATHWAY
    // =========================================================================
    if (provider === 'google') {
        let baseEndpoint = endpoint.split('/v1beta')[0].replace(/\/+$/, '');
        if (!baseEndpoint.startsWith('http')) baseEndpoint = 'https://generativelanguage.googleapis.com';

        const action = activeModel.stream ? 'streamGenerateContent' : 'generateContent';
        const url = `${baseEndpoint}/v1beta/models/${activeModel.id}:${action}`;

        const contents = fullHistory.map(msg => ({
            role: msg.role === 'ai' || msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
        }));

        const body = {
            contents,
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT || "You are AxilO, a senior autonomous AI assistant." }] },
            generationConfig: {
                temperature: activeModel.temperature !== undefined ? activeModel.temperature : 0.3,
                maxOutputTokens: activeModel.maxTokens || 4096
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': activeModel.apiKey
            },
            body: JSON.stringify(body),
            signal
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API ${response.status}: ${errText}`);
        }

        if (activeModel.stream && response.body) {
            let fullText = '';
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (!cleanLine.startsWith('data:')) continue;
                    try {
                        const parsed = JSON.parse(cleanLine.slice(5).trim());
                        const textDelta = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (textDelta) {
                            fullText += textDelta;
                            if (onToken) onToken(textDelta);
                        }
                    } catch (e) {}
                }
            }

            return { text: fullText, toolCalls: [], raw: null };
        } else {
            const json = await response.json();
            const fullText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (onToken && fullText) onToken(fullText);
            return { text: fullText, toolCalls: [], raw: json };
        }
    }

    throw new Error(`Unsupported AI provider: ${provider}`);
}

module.exports = { callAI };
