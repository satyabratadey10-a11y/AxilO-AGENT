const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const tools = require('./tools.js');
const api = require('./connection.js');

// --- TERMINAL UI ENGINE (ANSI) ---
const colors = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", magenta: "\x1b[35m", blue: "\x1b[34m", bgRed: "\x1b[41m" };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function sysLog(...args) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    if (args.length > 0) console.log(...args);
    rl.prompt(true);
}

class Spinner {
    constructor(text = "Processing") {
        this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.text = text;
        this.idx = 0;
        this.timer = null;
    }
    start() {
        if (this.timer) return;
        process.stdout.write("\x1B[?25l"); 
        this.timer = setInterval(() => {
            const spinStr = `${colors.cyan}${this.frames[this.idx]}${colors.reset} ${colors.dim}${this.text}...${colors.reset}`;
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`${spinStr}  |  ${colors.bold}${colors.cyan}❯ You:${colors.reset} ${rl.line}`);
            this.idx = (this.idx + 1) % this.frames.length;
        }, 120);
    }
    stop(clearLine = true) {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        process.stdout.write("\x1B[?25h"); 
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        if (!clearLine) console.log();
        rl.prompt(true); 
    }
    update(newText) { this.text = newText; }
}
const spinner = new Spinner();

let chatHistory = [];
let availableModels = [];
let activeModel = null;
let isProcessing = false;
let cancelWork = false;
let promptQueue = [];
let abortController = new AbortController();

let pasteBuffer = [];
let pasteTimer = null;

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

const askSync = (q) => new Promise(res => { rl.question(q, (ans) => res(ans)); });

const askToolConfirm = (q) => new Promise(res => {
    rl.removeListener('line', lineHandler);
    rl.question(q, (ans) => {
        rl.on('line', lineHandler);
        res(ans);
    });
});

// --- CORE REUSABLE MODEL SWITCHER ---
async function switchModelMenu() {
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
        return true;
    }
    return false;
}

const agentTools = [...tools.schemas, { 
    name: 'execute_command', description: 'Execute shell commands on the host OS.', 
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } 
}];

const SYSTEM_PROMPT = `You are an elite, autonomous AI Software Engineer running natively on Termux (Android/aarch64).
Available Tools: ${JSON.stringify(agentTools)}

CORE OPERATING PROCEDURES:
1. PLAN: Break the user's request into logical, discrete steps using the "task_manager". 
2. EXECUTE (Batching): Group multiple independent tool calls into a single response to save time and API requests.
3. VERIFY: Do not blindly assume a command worked. If you modify code, check the output or read the file to ensure the change was successful before proceeding.
4. TERMINATE (CRITICAL): Once the ultimate goal is achieved and verified, you MUST immediately set "action" to "complete" and provide a final summary to the user. DO NOT loop endlessly or invent new tasks.
5. FAIL-SAFE: If a tool fails 3 times in a row, or if you require manual user input (like a password or UI approval), stop your loop by setting "action" to "complete" and explicitly ask the user for assistance.

JSON SCHEMA ENFORCEMENT:
You must strictly format your ENTIRE response as a valid JSON object. No raw markdown outside the JSON brackets.

{
  "task_manager": {
    "current_goal": "Ultimate objective summary",
    "completed_tasks": ["Step 1 done"],
    "pending_tasks": ["Step 2 to do", "Step 3 to do"]
  },
  "action": "tool_call" | "complete",
  "calls": [{"tool": "tool_name", "args": {"arg_name": "value"}}], 
  "result": "Final comprehensive output, summary, or question for the user (ONLY used if action is 'complete')"
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
    if (base === '/btw') {
        const question = cmd.trim().substring(4).trim();
        if (!question) {
            sysLog(`${colors.yellow}⚠ Please provide a question. Usage: /btw <your question>${colors.reset}`);
            return;
        }
        
        const wasSpinning = spinner.timer !== null;
        if (wasSpinning) spinner.stop(true);
        
        sysLog(`\n${colors.bold}${colors.magenta}◆ [BTW Question]:${colors.reset} ${question}`);
        sysLog(`${colors.dim}Thinking... (Task execution continues in background)${colors.reset}`);
        if (wasSpinning) spinner.start();

        api.callAI({
            activeModel,
            chatHistory: [...chatHistory, { role: "user", content: question }],
            promptText: question,
            abortController: new AbortController(),
            spinner: { start: () => {}, stop: () => {}, update: () => {} },
            sysLog: () => {},
            colors,
            SYSTEM_PROMPT: "You are a world-class senior frontend/backend engineer. The user is asking a side question during an autonomous run. Answer directly, cleanly, and briefly without JSON structure."
        }).then(rawResponse => {
            const isNowSpinning = spinner.timer !== null;
            if (isNowSpinning) spinner.stop(true);
            
            let cleanSideResponse = rawResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            cleanSideResponse = cleanSideResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
            if (cleanSideResponse.startsWith('{') && cleanSideResponse.endsWith('}')) {
                try {
                    const parsed = JSON.parse(cleanSideResponse);
                    if (parsed.result) cleanSideResponse = parsed.result;
                } catch(e) {}
            }
            
            sysLog(`\n${colors.bold}${colors.magenta}◆ [BTW Answer]:${colors.reset}\n${cleanSideResponse}\n`);
            if (isNowSpinning) spinner.start();
        }).catch(err => {
            const isNowSpinning = spinner.timer !== null;
            if (isNowSpinning) spinner.stop(true);
            sysLog(`\n${colors.red}✖ [BTW Error]: ${err.message}${colors.reset}\n`);
            if (isNowSpinning) spinner.start();
        });
        return;
    }
    
    sysLog();
    if (base === '/' || base === '/help') {
        sysLog(`${colors.bold}${colors.cyan}--- Agentic Framework Commands ---${colors.reset}`);
        sysLog(`  ${colors.green}/btw <q>${colors.reset}         - Ask a quick question mid-session without breaking the task`);
        sysLog(`  ${colors.green}/stop${colors.reset}         - Interrupt active AI processing`);
        sysLog(`  ${colors.green}/model${colors.reset}        - Hot-swap the active AI core mid-session`);
        sysLog(`  ${colors.green}/settings${colors.reset}     - View framework configuration`);
        sysLog(`  ${colors.green}/instructions${colors.reset} - View the core Agent Prompt`);
        sysLog(`  ${colors.green}/skills${colors.reset}       - View loaded markdown skills`);
        sysLog(`  ${colors.green}/clear${colors.reset}        - Wipe chat context memory`);
        sysLog(`  ${colors.green}/exit${colors.reset}         - Terminate session safely`);
    } else if (base === '/model') {
        await switchModelMenu();
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
    console.log(`${colors.bold}${colors.magenta}│       AUTONOMOUS AGENT STUDIO v8.0       │${colors.reset}`);
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
    const rawLine = line; 

    if (rawLine.trim().startsWith('/') && pasteBuffer.length === 0) {
        await handleSlashCommand(rawLine.trim());
        if (!isProcessing) rl.prompt(true);
        return;
    }

    if (rawLine.trim().toLowerCase() === 'exit' && pasteBuffer.length === 0) {
        saveAndExit();
        return;
    }

    pasteBuffer.push(rawLine);

    if (pasteTimer) clearTimeout(pasteTimer);
    
    pasteTimer = setTimeout(() => {
        const finalInput = pasteBuffer.join('\n').trim();
        pasteBuffer = []; 

        if (!finalInput) {
            if (!isProcessing) rl.prompt(true);
            return;
        }

        promptQueue.push(finalInput);
        
        if (isProcessing) {
            sysLog(`${colors.dim}[Prompt queued: ${promptQueue.length} pending...]${colors.reset}`);
        } else {
            processNextInQueue();
        }
    }, 150); 
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
            const rawResponse = await api.callAI({
                activeModel,
                chatHistory,
                promptText: aiPrompt,
                abortController,
                spinner,
                sysLog,
                colors,
                SYSTEM_PROMPT
            });
            
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
                        
                        const confirm = await askToolConfirm(`Approve execution? ${colors.green}[y/N] or type feedback${colors.reset}: `);
                        const ans = confirm.trim();
                        
                        if (ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes') {
                            try { 
                                sysLog(`${colors.dim}Executing...${colors.reset}`);
                                toolResult = execSync(call.args.command, { encoding: 'utf8' }); 
                                sysLog(`${colors.green}✔ Command Complete${colors.reset}`);
                            } catch(e) { toolResult = `Error: ${e.message}`; }
                        } else if (ans.toLowerCase() === 'n' || ans.toLowerCase() === 'no' || ans === '') {
                            toolResult = "User denied command execution.";
                            sysLog(`${colors.red}✖ Execution Aborted${colors.reset}`);
                        } else {
                            toolResult = `User denied command execution and provided this feedback/instruction: "${ans}"`;
                            sysLog(`${colors.yellow}⚠ Execution Aborted. Feedback routed to AI.${colors.reset}`);
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

        // --- UPGRADED ERROR CATCH BLOCK WITH AUTO-MODEL CHANGER ---
        } catch(err) {
            spinner.stop(true);
            if (err.name === 'AbortError' || err.message === 'AbortError') {
                sysLog(`${colors.yellow}⚠ Task aborted successfully.${colors.reset}`);
                break;
            }
            
            sysLog(`\n${colors.red}${colors.bold}✖ API Error Intercepted:${colors.reset} ${err.message}\n`);
            
            sysLog(`${colors.bold}${colors.cyan}--- Auto-Model Rescue ---${colors.reset}`);
            sysLog(`  ${colors.dim}The current model (${activeModel.name}) rejected the request.${colors.reset}`);
            sysLog(`  ${colors.green}[M]${colors.reset} Switch to a different model and auto-resume task`);
            sysLog(`  ${colors.green}[A]${colors.reset} Abort and return to prompt`);
            
            rl.removeListener('line', lineHandler);
            const fallbackChoice = await askSync(`\nSelect action [M/A]: `);
            rl.on('line', lineHandler);

            if (fallbackChoice.trim().toLowerCase() === 'm') {
                const switched = await switchModelMenu();
                if (switched) {
                    sysLog(`\n${colors.green}✔ Resuming active task using ${activeModel.name}...${colors.reset}\n`);
                    abortController = new AbortController(); // Reset connection state
                    continue; // Magic command: Skips to the top of the while() loop and instantly retries the failed aiPrompt!
                } else {
                    sysLog(`${colors.yellow}⚠ Model switch cancelled. Task aborted.${colors.reset}`);
                    break;
                }
            } else {
                sysLog(`${colors.yellow}⚠ Task aborted by user.${colors.reset}`);
                break;
            }
        }
    }
    
    processNextInQueue();
}

loadConfig();
