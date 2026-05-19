const express = require('express');
const cors = require('cors');
const { AIAgentSHD } = require('./dist/AIAgentSHD.js');
const { ProfileManager } = require('./dist/ProfileManager.js');
const { SessionManager } = require('./dist/SessionManager.js');
const fs = require('node:fs/promises');
const { exec } = require('node:child_process');
const util = require('node:util');
const path = require('node:path');

const execAsync = util.promisify(exec);
const app = express();
app.use(cors());
app.use(express.json());

// --- CACHE BUSTING ALGORITHM ---
let lastValidDynamicTools = { schemas: [], execute: async () => {} };
function getHotReloadedTools() {
    const toolsPath = path.resolve('./tools.js');
    try {
        delete require.cache[require.resolve(toolsPath)];
        const mod = require(toolsPath);
        lastValidDynamicTools = mod;
        return mod;
    } catch (e) {
        console.error(`[API] Syntax Error in tools.js! ${e.message}`);
        return lastValidDynamicTools;
    }
}

// --- GLOBAL STATE ---
let agent = null;
let currentSession = null;
let sessionManager = null;
let activeHttpResponse = null;
let coreTools = [];

async function initializeServer() {
    console.log('\x1b[36m[TUF-AGENT API] Booting Headless Daemon...\x1b[0m');

    // 1. Load Profile
    const profileManager = new ProfileManager('./models.json');
    const profiles = await profileManager.getAllProfiles();
    if (profiles.length === 0) {
        console.error("\x1b[31m[Error] No profiles found in models.json. Run 'node add_model.js' first.\x1b[0m");
        process.exit(1);
    }
    
    const activeProfile = profiles.find(p => p.name.toLowerCase().includes('gemini')) || profiles[0];
    console.log(`\x1b[35m[API] Bound Default Model: ${activeProfile.name}\x1b[0m`);

    // 2. Load Session Manager
    sessionManager = new SessionManager('./sessions.json');
    
    // 3. Define Core Tools
    coreTools = [
        { name: 'write_file', description: 'Creates or overwrites a file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
        { name: 'delete_file', description: 'Deletes a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
        { name: 'execute_command', description: 'Executes a raw shell command.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }
    ];

    let dynamicToolsModule = getHotReloadedTools();

    // 4. Initialize Agent
    const config = {
        tools: [...coreTools, ...dynamicToolsModule.schemas],
        baseURL: activeProfile.api,
        apiKey: activeProfile.apiKey || "",
        modelName: activeProfile.modelId || activeProfile.name,
        extraParams: activeProfile.extraParams || { stream: false }
    };

    agent = new AIAgentSHD(config);

    // 5. Event Listeners for HTTP bridging
    agent.on('STEP_COMPLETED', (data) => console.log(`\x1b[90m[Agent]\x1b[0m ${data.message}`));

    agent.on('TOOL_CALL_REQUESTED', async (payload) => {
        try {
            if (['write_file', 'delete_file', 'execute_command'].includes(payload.toolName)) {
                console.log(`\x1b[33m[API] Tool ${payload.toolName} requires human approval. Suspending loop...\x1b[0m`);
                
                if (activeHttpResponse) {
                    activeHttpResponse.json({
                        status: "interrupted",
                        type: "approval_required",
                        callId: payload.callId,
                        toolName: payload.toolName,
                        args: payload.args
                    });
                    activeHttpResponse = null;
                }
                return;
            }

            dynamicToolsModule = getHotReloadedTools();
            if (dynamicToolsModule.schemas.find(t => t.name === payload.toolName)) {
                console.log(`\x1b[36m[API] Executing Autonomous Tool: ${payload.toolName}\x1b[0m`);
                const result = await dynamicToolsModule.execute(payload.toolName, payload.args);
                agent.resolveToolCall(payload.callId, result);
                return;
            }

            agent.resolveToolCall(payload.callId, `Error: Tool not found.`);
        } catch (err) {
            agent.resolveToolCall(payload.callId, `Execution Error: ${err.message}`);
        }
    });

    agent.on('TASK_COMPLETED', async (data) => {
        console.log(`\x1b[32m[API] Task Complete.\x1b[0m`);
        if (currentSession) {
            currentSession.memory = agent.getMemory();
            await sessionManager.saveSession(currentSession);
        }
        if (activeHttpResponse) {
            activeHttpResponse.json({ status: "success", response: data.finalOutput });
            activeHttpResponse = null;
        }
    });

    agent.on('TASK_FAILED', (data) => {
        console.error(`\x1b[31m[API Error]\x1b[0m ${data.error}`);
        if (activeHttpResponse) {
            activeHttpResponse.status(500).json({ status: "error", message: data.error });
            activeHttpResponse = null;
        }
    });

    // 6. Start HTTP Server
    const PORT = 8080;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\x1b[32m[TUF-AGENT API] Daemon active on http://127.0.0.1:${PORT}\x1b[0m`);
    });
}

// --- REST ENDPOINTS ---

app.post('/api/chat', async (req, res) => {
    const { prompt, sessionId } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // FIX: Proper Session Routing & ID preservation
    if (sessionId) {
        const sessions = await sessionManager.getAllSessions();
        currentSession = sessions.find(s => s.id === sessionId);
    }
    
    if (!currentSession) {
        // Now accurately registers the requested sessionId into the database
        currentSession = { id: sessionId || `session_${Date.now()}`, title: prompt.substring(0, 30), updatedAt: Date.now(), memory: [] };
    }

    agent.loadMemory(currentSession.memory);
    activeHttpResponse = res; 
    
    console.log(`\x1b[34m[API] Incoming prompt:\x1b[0m ${prompt}`);
    agent.startTask(prompt);
});

app.post('/api/approve', async (req, res) => {
    const { callId, approved, toolName, args } = req.body;

    if (!callId) return res.status(400).json({ error: "callId is required" });

    activeHttpResponse = res; 

    if (!approved) {
        console.log(`\x1b[31m[API] User denied execution of ${toolName}\x1b[0m`);
        agent.resolveToolCall(callId, "System Observation: User strictly denied permission to execute this action.");
        return;
    }

    console.log(`\x1b[32m[API] User approved execution of ${toolName}\x1b[0m`);
    try {
        if (toolName === 'execute_command') {
            const { stdout, stderr } = await execAsync(args.command, { maxBuffer: 1024 * 1024 * 10 });
            agent.resolveToolCall(callId, `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
        } else if (toolName === 'write_file') {
            await fs.writeFile(args.path, args.content, 'utf-8');
            let dynamicToolsModule = getHotReloadedTools();
            agent.reloadTools([...coreTools, ...dynamicToolsModule.schemas]);
            agent.resolveToolCall(callId, `Successfully wrote to ${args.path}. Capabilities re-synced.`);
        } else if (toolName === 'delete_file') {
            await fs.unlink(args.path);
            agent.resolveToolCall(callId, `Successfully deleted ${args.path}`);
        }
    } catch (err) {
        agent.resolveToolCall(callId, `Action Failed: ${err.message}`);
    }
});

initializeServer();
