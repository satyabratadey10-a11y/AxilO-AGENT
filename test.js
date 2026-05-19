const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const tools = require('./tools.js');

// --- TERMINAL UI ENGINE (ANSI) ---
const colors = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", magenta: "\x1b[35m", blue: "\x1b[34m", bgRed: "\x1b[41m" };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Async-Safe Logger
function sysLog(...args) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    if (args.length > 0) console.log(...args);
    rl.prompt(true);
}

// TERMUX-OPTIMIZED INLINE SPINNER
class Spinner {
    constructor(text = "Processing") {
        this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.text = text;
        this.idx = 0;
        this.timer = null;
    }
    start() {
        if (this.timer) return;
        process.stdout.write("\x1B[?25l"); // Hide cursor
        this.timer = setInterval(() => {
            const spinStr = `${colors.cyan}${this.frames[this.idx]}${colors.reset} ${colors.dim}${this.text}...${colors.reset}`;
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            // Render spinner AND the user's current input buffer on the exact same line
            process.stdout.write(`${spinStr}  |  ${colors.bold}${colors.cyan}❯ You:${colors.reset} ${rl.line}`);
            this.idx = (this.idx + 1) % this.frames.length;
        }, 120);
    }
    stop(clearLine = true) {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        process.stdout.write("\x1B[?25h"); // Show cursor
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        if (!clearLine) console.log();
        rl.prompt(true); 
    }
    update(newText) { this.text = newText; }
}
const spinner = new Spinner();

// --- STATE & QUEUE MANAGEMENT ---
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastApiCallTime = 0;
const MIN_API_DELAY_MS = 4000; 
let chatHistory = [];
let availableModels = [];
let activeModel = null;

let isProcessing = false;
let cancelWork = false;
let promptQueue = [];
let abortController = new AbortController();

function pruneHistory(history, maxTurns = 10) {
    if (history.length <= maxTurns) return history;
    return [...history.slice(0, 2), { role: "system", content: "[System: Older context pruned to conserve token bandwidth]" }, ...history.slice(-(maxTurns - 1))];
}

const _originalParse = JSON.parse;
JSON.parse = function(text, reviver) {
    if (typeof text !== 'string') return _originalParse(text, reviver);
    try { return _originalParse(text, reviver); } catch (e) {
        try {
            let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start !== -1 && end !== -1 && start < end) {
                return _originalParse(cleaned.substring(start, end + 1), reviver);
            }
        } catch(err) {}
        throw e;
    }
};

const askSync = (q) => new Promise(res => {
    rl.question(q, (ans) => res(ans));
});

const askToolConfirm = (q) => new Promise(res => {
    rl.removeListener('line', lineHandler);
    rl.question(q, (ans) => {
        rl.on('line', lineHandler);
        res(ans);
    });
});

const agentTools = [...tools.schemas, { 
    name: 'execute_command', description: 'Execute shell commands on the host OS.', 
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } 
}];

const SYSTEM_PROMPT = `You are an autonomous AI Agent running natively on Termux (Android).
Available Tools: ${JSON.stringify(agentTools)}

CRITICAL INSTRUCTION: You MUST use this exact JSON structure for EVERY response. 
Batch multiple tool calls into the "calls" array whenever possible to minimize API requests.

{
  "task_manager": {
    "current_goal": "A short summary of the ultimate objective",
    "completed_tasks": ["Step 1 done"],
    "pending_tasks": ["Step 2 to do"]
  },
  "action": "tool_call" | "complete",
  "calls": [{"tool": "tool_name", "args": {"arg_name": "value"}}], 
  "result": "Final output to the user (ONLY used if action is 'complete')"
}`;

function saveAndExit() {
    spinner.start();
    spinner.update("Saving context");
    fs.writeFileSync('history.json', JSON.stringify(chatHistory, null, 2));
    spinner.stop();
    sysLog(`${colors.green}✔ Context saved. Terminating.${colors.reset}`);
    process.exit(0);
}

async function handleSlashCommand(cmd) {
    const base = cmd.trim().toLowerCase().split(' ')[0];
    
    if (base === '/stop') {
        if (isProcessing) {
            cancelWork = true;
            abortController.abort();
            abortController = new AbortController(); 
            sysLog(`${colors.yellow}⚠ AI execution interrupted by user.${colors.reset}`);
        } else {
            sysLog(`${colors.dim}No active AI process to stop.${colors.reset}`);
        }
        return;
    }
    if (base === '/exit') {
        saveAndExit();
        return;
    }
    
    sysLog();
    if (base === '/' || base === '/help') {
        sysLog(`${colors.bold}${colors.cyan}--- Agentic Framework Commands ---${colors.reset}`);
        sysLog(`  ${colors.green}/stop${colors.reset}         - Interrupt active AI processing`);
        sysLog(`  ${colors.green}/model${colors.reset}        - Hot-swap the active AI core mid-session`);
        sysLog(`  ${colors.green}/settings${colors.reset}     - View framework configuration`);
        sysLog(`  ${colors.green}/instructions${colors.reset} - View the core Agent Prompt`);
        sysLog(`  ${colors.green}/skills${colors.reset}       - View loaded markdown skills`);
        sysLog(`  ${colors.green}/clear${colors.reset}        - Wipe chat context memory`);
        sysLog(`  ${colors.green}/exit${colors.reset}         - Terminate session safely`);
    } else if (base === '/model') {
        sysLog(`${colors.bold}${colors.cyan}--- Switch Active Core ---${colors.reset}`);
        try { if (fs.existsSync('models.json')) availableModels = JSON.parse(fs.readFileSync('models.json', 'utf8')); } catch(e) {}
        availableModels.forEach((m, i) => sysLog(`  ${colors.cyan}[${i+1}]${colors.reset} ${m.name}`));
        
        rl.removeListener('line', lineHandler);
        const choice = await askSync(`\nSelect a new core [1-${availableModels.length}] or press Enter to cancel: `);
        rl.on('line', lineHandler);
        
        const index = parseInt(choice) - 1;
        if (!isNaN(index) && index >= 0 && index < availableModels.length) {
            activeModel = availableModels[index];
            sysLog(`${colors.green}✔ Active core switched to: ${activeModel.name}${colors.reset}`);
        }
    } else if (base === '/settings') {
        sysLog(`${colors.bold}${colors.cyan}--- System Settings ---${colors.reset}`);
        sysLog(`Core Engine: ${colors.yellow}${activeModel.name}${colors.reset}`);
        sysLog(`Endpoint: ${colors.dim}${activeModel.baseUrl || "Default Google"}${colors.reset}`);
        sysLog(`Queue Status: ${promptQueue.length > 0 ? colors.yellow + promptQueue.length + " pending" : colors.green + "Empty"}${colors.reset}`);
    } else if (base === '/instructions') {
        sysLog(`${colors.bold}${colors.cyan}--- Base Instructions ---${colors.reset}\n${SYSTEM_PROMPT}`);
    } else if (base === '/skills') {
        sysLog(`${colors.bold}${colors.cyan}--- Installed Skills ---${colors.reset}`);
        if (!fs.existsSync('./skills')) fs.mkdirSync('./skills');
        const files = fs.readdirSync('./skills').filter(f => f.endsWith('.md'));
        if (files.length === 0) sysLog(`${colors.dim}No skills found.${colors.reset}`);
        else files.forEach(f => sysLog(`  ${colors.green}• ${f}${colors.reset}`));
    } else if (base === '/clear') {
        chatHistory = [];
        sysLog(`${colors.green}✔ Context memory wiped.${colors.reset}`);
    } else {
        sysLog(`${colors.red}✖ Unknown command.${colors.reset}`);
    }
    sysLog();
}

async function loadConfig() {
    console.clear();
    console.log(`${colors.bold}${colors.magenta}┌──────────────────────────────────────────┐${colors.reset}`);
    console.log(`${colors.bold}${colors.magenta}│       AUTONOMOUS AGENT STUDIO v5.1       │${colors.reset}`);
    console.log(`${colors.bold}${colors.magenta}└──────────────────────────────────────────┘${colors.reset}\n`);
    
    try {
        availableModels = JSON.parse(fs.readFileSync('models.json', 'utf8'));
    } catch(e) {
        console.log(`${colors.yellow}⚠️ models.json not found. Run 'node add_model.js' first.${colors.reset}`);
        process.exit(1);
    }

    console.log(`${colors.bold}Available Cores:${colors.reset}`);
    availableModels.forEach((m, i) => console.log(`  ${colors.cyan}[${i+1}]${colors.reset} ${m.name}`));
    const choice = await askSync(`\nSelect a core [1-${availableModels.length}]: `);
    activeModel = availableModels[parseInt(choice)-1] || availableModels[0];

    console.log(`\n${colors.bold}Session State:${colors.reset}`);
    console.log(`  ${colors.cyan}[1]${colors.reset} New Environment\n  ${colors.cyan}[2]${colors.reset} Resume Context`);
    const sessionChoice = await askSync("\nSelect option: ");
    if (sessionChoice === '2' && fs.existsSync('history.json')) chatHistory = JSON.parse(fs.readFileSync('history.json', 'utf8'));
    if (!fs.existsSync('./skills')) fs.mkdirSync('./skills');

    console.clear();
    console.log(`${colors.dim}Session active. Model: ${activeModel.name}. Type '/' for menu.${colors.reset}\n`);
    
    rl.setPrompt(`\n${colors.bold}${colors.cyan}❯ You:${colors.reset} `);
    rl.prompt(true);
    rl.on('line', lineHandler);
}

async function lineHandler(line) {
    const input = line.trim();
    if (!input) { rl.prompt(true); return; }

    if (input.startsWith('/')) {
        await handleSlashCommand(input);
        if (!isProcessing) rl.prompt(true);
        return;
    }

    if (input.toLowerCase() === 'exit') {
        saveAndExit();
        return;
    }

    promptQueue.push(input);
    
    if (isProcessing) {
        sysLog(`${colors.dim}[Prompt queued: ${promptQueue.length} pending...]${colors.reset}`);
    } else {
        processNextInQueue();
    }
}

async function callAI(promptText) {
    if (activeModel.isLocal) {
        const safePrompt = JSON.stringify(promptText);
        const output = execSync(`python litert_engine.py --model "./gemma-local.tflite" --prompt ${safePrompt}`, { encoding: 'utf-8' });
        return JSON.parse(output.trim()).response;
    } else {
        const prunedHistory = pruneHistory(chatHistory);
        const baseUrl = activeModel.baseUrl || "https://generativelanguage.googleapis.com";
        const isGemini = baseUrl.includes('googleapis.com');
        
        let fetchUrl = "";
        let fetchOptions = { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abortController.signal };
        let fetchBody = {};

        if (isGemini) {
            fetchUrl = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${activeModel.modelId}:generateContent?key=${activeModel.apiKey}`;
            const messages = prunedHistory.map(msg => ({ role: msg.role === 'ai' || msg.role === 'system' ? 'model' : 'user', parts: [{ text: msg.content }] }));
            messages.push({ role: "user", parts: [{ text: promptText }] });
            fetchBody = {
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: messages,
                generationConfig: { responseMimeType: "application/json", temperature: activeModel.temperature || 0.7, maxOutputTokens: activeModel.maxTokens || 4096 }
            };
        } else {
            fetchUrl = baseUrl;
            fetchOptions.headers['Authorization'] = `Bearer ${activeModel.apiKey}`;
            fetchOptions.headers['HTTP-Referer'] = 'https://github.com/termux-agent';
            
            const messages = [
                { role: "system", content: SYSTEM_PROMPT },
                ...prunedHistory.map(msg => ({ role: msg.role === 'ai' ? 'assistant' : msg.role, content: msg.content })),
                { role: "user", content: promptText }
            ];

            fetchBody = { model: activeModel.modelId, messages: messages, temperature: activeModel.temperature || 0.7, max_tokens: activeModel.maxTokens || 4096, stream: false };
        }

        fetchOptions.body = JSON.stringify(fetchBody);

        const maxRetries = 6;
        let retries = 0;

        while (retries < maxRetries) {
            if (cancelWork) throw new Error("AbortError");
            const timeSinceLastCall = Date.now() - lastApiCallTime;
            if (timeSinceLastCall < MIN_API_DELAY_MS) {
                spinner.update("Queueing request");
                await sleep(MIN_API_DELAY_MS - timeSinceLastCall);
            }
            if (cancelWork) throw new Error("AbortError");

            lastApiCallTime = Date.now();
            if (retries > 0) spinner.update(`Retrying (${retries}/${maxRetries})`);

            let rawText = "";
            let res;
            try {
                res = await fetch(fetchUrl, fetchOptions);
                rawText = await res.text(); 
            } catch(e) {
                if (e.name === 'AbortError') throw e;
                throw new Error(`Network failure: ${e.message}`);
            }
            
            let data;
            try { data = JSON.parse(rawText); } 
            catch(e) { throw new Error(`API returned an invalid payload: ${rawText.substring(0, 150)}...`); }
            
            if (!res.ok) {
                if (res.status === 429 || res.status === 402) {
                    retries++;
                    let providerError = "Rate Limit or Insufficient Quota";
                    if (data.error && data.error.message) providerError = data.error.message;
                    
                    spinner.stop(true);
                    sysLog(`${colors.yellow}⚠ API Rejection [Status ${res.status}]: ${providerError}${colors.reset}`);
                    spinner.start();

                    let waitTimeMs = (4000 * Math.pow(2, retries)) + Math.floor(Math.random() * 1000); 
                    try {
                        const details = data.error?.details?.find(d => d['@type'].includes('RetryInfo'));
                        if (details && details.retryDelay) waitTimeMs = Math.max(waitTimeMs, parseInt(details.retryDelay.replace('s', '')) * 1000 + 1000); 
                    } catch(e) {}
                    
                    spinner.update(`Cooldown for ${(waitTimeMs/1000).toFixed(1)}s`);
                    await sleep(waitTimeMs);
                    continue; 
                }
                throw new Error(JSON.stringify(data));
            }
            
            const aiText = isGemini ? data.candidates?.[0]?.content?.parts?.[0]?.text : data.choices?.[0]?.message?.content;
            if (!aiText) throw new Error("Model API returned empty or null content.");
            return aiText;
        }
        throw new Error("Maximum rate limit retries exceeded.");
    }
}

async function processNextInQueue() {
    if (promptQueue.length === 0) {
        isProcessing = false;
        rl.prompt(true);
        return;
    }

    isProcessing = true;
    cancelWork = false;
    const currentPrompt = promptQueue.shift();
    chatHistory.push({ role: "user", content: currentPrompt });
    
    let isComplete = false;
    let aiPrompt = currentPrompt;
    sysLog(); 

    while (!isComplete && !cancelWork) {
        spinner.start();
        spinner.update("Thinking & Planning");
        
        try {
            const rawResponse = await callAI(aiPrompt);
            spinner.stop(true);
            if (cancelWork) break;

            const thinkMatch = rawResponse.match(/<think>([\s\S]*?)<\/think>/i);
            if (thinkMatch && thinkMatch[1]) sysLog(`${colors.dim}🧠 Reasoning:${thinkMatch[1]}\n${colors.reset}`);
            
            let parsed;
            try {
                parsed = JSON.parse(rawResponse);
                if (parsed === null || typeof parsed !== 'object') throw new Error("Parsed result is not a valid JSON object.");
            } catch (err) {
                let fallbackText = rawResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json/gi, '').replace(/```/g, '').trim();
                sysLog(`${colors.bold}${colors.green}◆ AI:${colors.reset}\n${fallbackText}`);
                chatHistory.push({ role: "ai", content: rawResponse });
                break;
            }

            if (parsed.task_manager) {
                sysLog(`${colors.bold}${colors.blue}📝 Task Board:${colors.reset} ${colors.dim}${parsed.task_manager.current_goal}${colors.reset}`);
                if (parsed.task_manager.completed_tasks) parsed.task_manager.completed_tasks.forEach(t => sysLog(`  ${colors.green}✔ ${t}${colors.reset}`));
                if (parsed.task_manager.pending_tasks) parsed.task_manager.pending_tasks.forEach(t => sysLog(`  ${colors.dim}□ ${t}${colors.reset}`));
                sysLog();
            }

            if (parsed.action === "tool_call" && Array.isArray(parsed.calls)) {
                let combinedResults = "";
                for (const call of parsed.calls) {
                    if (cancelWork) break;
                    sysLog(`${colors.yellow}  ↳ ⚙️ Invoking Tool: ${call.tool}${colors.reset}`);
                    let toolResult = "";
                    
                    if (call.tool === 'execute_command') {
                        sysLog(`\n${colors.bgRed}${colors.bold} SYSTEM COMMAND WARNING ${colors.reset}`);
                        sysLog(`${colors.dim}Command:${colors.reset} ${call.args.command}\n`);
                        
                        const confirm = await askToolConfirm(`Approve execution? ${colors.green}(y/N)${colors.reset}: `);
                        
                        if (confirm.toLowerCase() === 'y') {
                            try { 
                                sysLog(`${colors.dim}Executing...${colors.reset}`);
                                toolResult = execSync(call.args.command, { encoding: 'utf8' }); 
                                sysLog(`${colors.green}✔ Command Complete${colors.reset}`);
                            } catch(e) { toolResult = `Error: ${e.message}`; }
                        } else {
                            toolResult = "User denied command execution.";
                            sysLog(`${colors.red}✖ Execution Aborted${colors.reset}`);
                        }
                    } else {
                        spinner.start();
                        spinner.update(`Running ${call.tool}`);
                        toolResult = await tools.execute(call.tool, call.args);
                        spinner.stop(true);
                    }
                    combinedResults += `\n--- Result for ${call.tool} ---\n${toolResult}\n`;
                }
                aiPrompt = `Batched tools executed. Results:\n${combinedResults}\nUpdate your task manager and continue.`;
                chatHistory.push({ role: "system", content: aiPrompt });
                
            } else if (parsed.action === "complete") {
                sysLog(`${colors.bold}${colors.green}◆ AI:${colors.reset}\n${parsed.result}`);
                chatHistory.push({ role: "ai", content: parsed.result });
                isComplete = true;
            } else {
                sysLog(`${colors.bold}${colors.green}◆ AI:${colors.reset}\n${JSON.stringify(parsed, null, 2)}`);
                chatHistory.push({ role: "ai", content: JSON.stringify(parsed) });
                isComplete = true;
            }

        } catch(err) {
            spinner.stop(true);
            if (err.name === 'AbortError' || err.message === 'AbortError') {
                sysLog(`${colors.yellow}⚠ Task aborted successfully.${colors.reset}`);
            } else {
                sysLog(`\n${colors.red}${colors.bold}✖ System Error:${colors.reset} ${err.message}\n`);
            }
            break; 
        }
    }
    processNextInQueue();
}

loadConfig();
