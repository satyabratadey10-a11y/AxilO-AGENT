#!/usr/bin/env node
/**
 * AxilO Code v2.5.0 — Elite Autonomous CLI AI Agent
 * Terminal UI (TUI) matching Claude Code aesthetics with real-time animation,
 * streaming, autonomous tool calling, slash commands, and dynamic skill routing.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const { exec, execSync } = require('child_process');

const BASE_DIR = __dirname;
const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');
const MODELS_FILE = path.join(BASE_DIR, 'models.json');
const CONFIG_FILE = path.join(BASE_DIR, 'config.json');
const MEMO_FILE = path.join(BASE_DIR, 'imp_memo.md');
const SKILLS_DIR = path.join(BASE_DIR, 'skills');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });

let agentConfig = { logoStyle: 'cyberpunk' };
try {
    if (fs.existsSync(CONFIG_FILE)) {
        agentConfig = { ...agentConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
} catch(e) {}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(agentConfig, null, 2));
    } catch(e) {}
}

const tools = require(path.join(BASE_DIR, 'tools.js'));
const api = require(path.join(BASE_DIR, 'connection.js'));

// ANSI Styling & Palette
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    
    // Foreground
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    
    // Bright & 256 colors
    coral: '\x1b[38;5;208m',
    brightCyan: '\x1b[38;5;51m',
    amber: '\x1b[38;5;214m',
    gray: '\x1b[38;5;244m',
    darkGray: '\x1b[38;5;238m',
    
    // Background
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m'
};

// Global Agent State
let activeModel = null;
let availableModels = [];
let chatHistory = [];
let currentSessionDir = null;
let currentSessionMeta = null;
let activeSkillContext = null;
let isProcessing = false;
let currentAbortController = null;
const CEILING_TURNS = 25;

// Cogitating Spinner Engine
class CogitationSpinner {
    constructor() {
        this.frames = ['✻', '✽', '✶', '✳', '·', '✢'];
        this.frameIdx = 0;
        this.timer = null;
        this.startTime = null;
        this.text = 'Cogitating';
    }

    start(actionText = 'Cogitating') {
        if (this.timer) return;
        this.text = actionText;
        this.startTime = Date.now();
        this.frameIdx = 0;
        process.stdout.write('\x1b[?25l'); // Hide cursor

        this.timer = setInterval(() => {
            const elapsedMs = Date.now() - this.startTime;
            const seconds = Math.floor(elapsedMs / 1000);
            let timeStr = `${seconds}s`;
            if (seconds >= 60) {
                const mins = Math.floor(seconds / 60);
                const remSecs = seconds % 60;
                timeStr = `${mins}m ${remSecs}s`;
            }

            const glyph = this.frames[this.frameIdx % this.frames.length];
            this.frameIdx++;

            process.stdout.write(`\r\x1b[2K${C.coral}${glyph}${C.reset} ${C.gray}${this.text} for ${timeStr}${C.reset}`);
        }, 150);
    }

    update(text) {
        this.text = text;
    }

    stop(clearLine = true) {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        process.stdout.write('\x1b[?25h'); // Restore cursor
        if (clearLine) {
            process.stdout.write('\r\x1b[2K');
        } else {
            process.stdout.write('\n');
        }
    }
}

const spinner = new CogitationSpinner();

// Load Config & Models
function loadModels() {
    try {
        if (fs.existsSync(MODELS_FILE)) {
            availableModels = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
        }
    } catch (e) {
        availableModels = [];
    }

    if (availableModels.length === 0) {
        availableModels = [{
            name: 'GPT-5.6 Sol (AgentRouter)',
            id: 'gpt-5.6-sol',
            endpoint: 'https://agentrouter.org',
            apiKey: 'sk-xz0htv16oEc2XjwyYcd699XvyJ3IFtGXeUo5XTUk079H5Z5B',
            provider: 'agentrouter',
            temperature: 0.3,
            maxTokens: 4096,
            stream: true
        }];
        fs.writeFileSync(MODELS_FILE, JSON.stringify(availableModels, null, 2));
    }
    activeModel = { ...availableModels[0] };
}

function saveModels() {
    fs.writeFileSync(MODELS_FILE, JSON.stringify(availableModels, null, 2));
}

// System Instruction Builder
function buildSystemPrompt() {
    let memoryBlock = '';
    if (fs.existsSync(MEMO_FILE)) {
        memoryBlock = `\n\n=== PERSISTENT CORE MEMORY (imp_memo.md) ===\n${fs.readFileSync(MEMO_FILE, 'utf8')}\n============================================\n`;
    }

    let skillsListing = '';
    try {
        const skills = getAvailableSkills();
        if (skills.length > 0) {
            skillsListing = `\n\n=== INSTALLED SKILLS ===\nAvailable skills: ${skills.map(s => s.name).join(', ')}. Use the 'import_skill' tool to read a skill's full markdown instructions whenever relevant.`;
        }
    } catch(e) {}

    let skillInjection = '';
    if (activeSkillContext) {
        skillInjection = `\n\n=== ACTIVE DOMAIN GUIDELINES (${activeSkillContext.name}) ===\n${activeSkillContext.content}\n=== END DOMAIN GUIDELINES ===\nIMPORTANT: The above domain guidelines offer technical domain methodology. You ALWAYS have unrestricted shell access via 'execute_command' and native tools ('inspect_apk', 'open_binary', 'search_android_classes', 'analyze_function', 'read_file', 'write_file', 'patch_file'). If a specialized MCP tool mentioned in the guideline is not present as a native tool, execute the inspection directly using Linux CLI tools (unzip, strings, grep, aapt2, dexdump) through 'execute_command' or 'open_binary'.\n`;
    }

    return `You are AxilO, a world-class autonomous software engineering and reverse engineering AI agent running natively in the user's terminal.
Current working directory: ${process.cwd()}
Host environment: Linux / Android Termux (aarch64)

CRITICAL OPERATING RULES:
1. AUTONOMOUS TOOL EXECUTION:
   - YOU MUST EXECUTE TOOLS DIRECTLY. Do NOT write markdown bash commands (like \`\`\`bash ... \`\`\`) expecting the user to copy-paste or execute them for you.
   - When asked to investigate, inspect, unpack, or decompile, invoke 'open_binary', 'inspect_apk', or 'execute_command' IMMEDIATELY.
2. FULL CONVERSATION MEMORY:
   - You have continuous conversational memory across this entire session. All previous user inputs and answers are in the message history above.
   - When the user asks what they asked earlier, asks to recall previous steps, or tests your memory, check the conversation messages above and answer specifically.
   - NEVER recite generic disclaimers claiming "I don't have memory", "each session starts fresh", or "I cannot recall earlier messages". You CAN see the full conversation.
3. NATIVE TOOLS AVAILABLE:
   - 'execute_command': Run bash shell commands directly in Linux/Android Termux.
   - 'open_binary': Inspect binary and Android APK packages (structure, DEX files, manifest, strings).
   - 'inspect_apk': Extract AndroidManifest.xml, list DEX files, or search strings.
   - 'search_android_classes': Search class names, activities, and dialog components in APKs.
   - 'analyze_function': Search and analyze class methods, functions, and symbols.
   - 'read_file', 'write_file', 'patch_file', 'list_directory': Inspect and surgically modify project files.
   - 'manage_task': List, check status, inspect logs, or terminate background tasks.
4. APK ANALYSIS: When investigating Android APKs, use 'open_binary' or 'inspect_apk' or execute shell commands ('unzip -l', 'strings', 'dexdump', 'aapt2', 'grep') to locate dialogs, update gates, and features.
5. RESPONSE STYLE: Be concise, direct, and actionable. Keep internal reasoning focused and rapid.${memoryBlock}${skillsListing}${skillInjection}`;
}

// Session & Shared Memory Architecture (Dedicated Directory per Session)
function generateSessionId() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).substring(2, 6);
    return `session_${dateStr}_${rand}`;
}

function loadSession(sessionDir) {
    if (!fs.existsSync(sessionDir)) return false;
    currentSessionDir = sessionDir;
    const memoryFile = path.join(sessionDir, 'memory.json');
    const sessionFile = path.join(sessionDir, 'session.json');

    try {
        if (fs.existsSync(memoryFile)) {
            const mem = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
            chatHistory = mem.history || [];
        } else {
            chatHistory = [];
        }

        if (fs.existsSync(sessionFile)) {
            currentSessionMeta = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        } else {
            const sid = path.basename(sessionDir);
            currentSessionMeta = {
                id: sid,
                name: sid,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                activeModel: activeModel ? activeModel.id : null,
                modelsUsed: activeModel ? [activeModel.id] : [],
                cwd: process.cwd(),
                messageCount: chatHistory.length
            };
        }
        return true;
    } catch (e) {
        return false;
    }
}

function createSession(name, immediateWrite = false) {
    const sid = name ? `session_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}` : generateSessionId();
    currentSessionDir = path.join(SESSIONS_DIR, sid);
    chatHistory = [];
    currentSessionMeta = {
        id: sid,
        name: name || sid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeModel: activeModel ? activeModel.id : null,
        modelsUsed: activeModel ? [activeModel.id] : [],
        cwd: process.cwd(),
        messageCount: 0
    };
    if (immediateWrite) {
        saveSession(true);
    }
    return currentSessionDir;
}

function saveSession(force = false) {
    if (chatHistory.length === 0 && !force) return;
    if (!currentSessionDir) {
        createSession(null, false);
    }
    if (!fs.existsSync(currentSessionDir)) {
        fs.mkdirSync(currentSessionDir, { recursive: true });
    }

    const memoryFile = path.join(currentSessionDir, 'memory.json');
    const sessionFile = path.join(currentSessionDir, 'session.json');

    if (!currentSessionMeta) {
        const sid = path.basename(currentSessionDir);
        currentSessionMeta = {
            id: sid,
            name: sid,
            createdAt: Date.now(),
            cwd: process.cwd()
        };
    }

    // Update metadata
    currentSessionMeta.updatedAt = Date.now();
    currentSessionMeta.activeModel = activeModel ? activeModel.id : null;
    if (!currentSessionMeta.modelsUsed) currentSessionMeta.modelsUsed = [];
    if (activeModel && !currentSessionMeta.modelsUsed.includes(activeModel.id)) {
        currentSessionMeta.modelsUsed.push(activeModel.id);
    }
    currentSessionMeta.messageCount = chatHistory.length;

    // Memory object: shared across models within this session
    const memoryData = {
        sessionId: currentSessionMeta.id,
        savedAt: Date.now(),
        activeModel: activeModel ? activeModel.id : null,
        modelsUsed: currentSessionMeta.modelsUsed,
        history: chatHistory
    };

    try {
        fs.writeFileSync(memoryFile, JSON.stringify(memoryData, null, 2));
        fs.writeFileSync(sessionFile, JSON.stringify(currentSessionMeta, null, 2));
    } catch (e) {}
}

function listSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    try {
        const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
        const list = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dir = path.join(SESSIONS_DIR, entry.name);
            const sFile = path.join(dir, 'session.json');
            const mFile = path.join(dir, 'memory.json');
            let meta = null;
            let msgCount = 0;
            if (fs.existsSync(sFile)) {
                try { meta = JSON.parse(fs.readFileSync(sFile, 'utf8')); } catch(e) {}
            }
            if (fs.existsSync(mFile)) {
                try {
                    const mem = JSON.parse(fs.readFileSync(mFile, 'utf8'));
                    msgCount = mem.history ? mem.history.length : 0;
                } catch(e) {}
            }
            list.push({
                id: entry.name,
                dir,
                name: meta?.name || entry.name,
                createdAt: meta?.createdAt || 0,
                updatedAt: meta?.updatedAt || 0,
                activeModel: meta?.activeModel || 'unknown',
                modelsUsed: meta?.modelsUsed || [],
                messageCount: msgCount
            });
        }
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        return list;
    } catch (e) {
        return [];
    }
}

// Discover Available Skills
function getAvailableSkills() {
    const list = [];
    const searchDirs = [
        SKILLS_DIR,
        path.join(os.homedir(), '.agents', 'skills'),
        path.join(os.homedir(), '.claude', 'skills')
    ];

    for (const dir of searchDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const skillMd = path.join(dir, entry.name, 'SKILL.md');
                    if (fs.existsSync(skillMd)) {
                        if (!list.some(s => s.name === entry.name)) {
                            list.push({ name: entry.name, path: skillMd, isDir: true });
                        }
                    }
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    const name = entry.name.replace(/\.md$/, '');
                    if (!list.some(s => s.name === name)) {
                        list.push({ name, path: path.join(dir, entry.name), isDir: false });
                    }
                }
            }
        } catch(e) {}
    }
    return list;
}

function loadSkill(skillName) {
    const cleanName = skillName.toLowerCase().replace(/^\//, '');
    const skills = getAvailableSkills();
    
    // Check exact match
    let found = skills.find(s => s.name.toLowerCase() === cleanName);
    
    // Check aliases
    if (!found) {
        if (cleanName === 'rea' || cleanName === 'reverse-engineer') {
            found = skills.find(s => s.name.toLowerCase().includes('reverse-engineer'));
        }
    }

    if (found) {
        try {
            const content = fs.readFileSync(found.path, 'utf8');
            return { name: found.name, path: found.path, content };
        } catch (e) {
            return null;
        }
    }
    return null;
}

// AxilO Distinctive Logo Signatures
const LOGO_STYLES = {
    cyberpunk: {
        id: 'cyberpunk',
        name: 'Cyberpunk 2077 (Neon Glitch Matrix)',
        render: (meta1, meta2, meta3) => {
            console.log(` ${C.cyan}◢◤${C.magenta}█▓▒░${C.cyan}◥◣${C.reset}   ${meta1}`);
            console.log(` ${C.magenta}▌ ${C.cyan}⟨AX⟩${C.magenta} ▐${C.reset}   ${meta2}`);
            console.log(` ${C.cyan}◥◣${C.magenta}░▒▓█${C.cyan}◢◤${C.reset}   ${meta3}`);
        }
    },
    quantum: {
        id: 'quantum',
        name: 'Quantum Nexus (Hyper-Geometric Hex Crystal)',
        render: (meta1, meta2, meta3) => {
            console.log(` ${C.blue} ⬡ ⬢ ⬡${C.reset}     ${meta1}`);
            console.log(` ${C.purple} ⬢ ❖ ⬢${C.reset}     ${meta2}`);
            console.log(` ${C.blue} ⬡ ⬢ ⬡${C.reset}     ${meta3}`);
        }
    },
    singularity: {
        id: 'singularity',
        name: 'Antigravity Singularity (Event Horizon / Celestial Orbit)',
        render: (meta1, meta2, meta3) => {
            console.log(` ${C.purple} ◬ ◢█◣ ◬${C.reset}   ${meta1}`);
            console.log(` ${C.cyan}━╋━ ◈ ━╋━${C.reset}  ${meta2}`);
            console.log(` ${C.purple} ▽ ◥█◤ ▽${C.reset}   ${meta3}`);
        }
    },
    mecha: {
        id: 'mecha',
        name: 'Tactical Obsidian Mecha (Industrial Aegis Shield)',
        render: (meta1, meta2, meta3) => {
            console.log(` ${C.orange} ▞▀█▀▚${C.reset}      ${meta1}`);
            console.log(` ${C.orange} ▌${C.yellow}▲█▲${C.orange}▐${C.reset}      ${meta2}`);
            console.log(` ${C.orange} ▚▄█▄▞${C.reset}      ${meta3}`);
        }
    },
    apex: {
        id: 'apex',
        name: 'Apex Kinetic Ligature (Angular Minimalist A-X Monogram)',
        render: (meta1, meta2, meta3) => {
            console.log(` ${C.green} ▲ ╱█╲ ▲${C.reset}   ${meta1}`);
            console.log(` ${C.green} █  ╳  █${C.reset}   ${meta2}`);
            console.log(` ${C.green} ▼ ╲█╱ ▼${C.reset}   ${meta3}`);
        }
    }
};

// AxilO Header Banner Renderer
function renderHeaderBanner() {
    const termWidth = process.stdout.columns || 80;
    const dividerLen = Math.max(20, Math.min(termWidth - 2, 68));
    const divider = '─'.repeat(dividerLen);
    
    let endpointHost = '';
    try {
        const u = new URL(activeModel.endpoint);
        endpointHost = u.hostname;
    } catch(e) {
        endpointHost = activeModel.endpoint || 'API Gateway';
    }

    const meta1 = `${C.bold}AxilO Code v2.5.0${C.reset} ${C.gray}· ${activeModel.id}${C.reset}`;
    const meta2 = `${C.gray}${endpointHost} · ${process.cwd()}${C.reset}`;
    const meta3 = `${C.dim}Welcome to AxilO! · /help for commands · /model to switch${C.reset}`;

    const currentStyle = agentConfig.logoStyle || 'cyberpunk';
    const logoRenderer = LOGO_STYLES[currentStyle]?.render || LOGO_STYLES.cyberpunk.render;

    console.log();
    logoRenderer(meta1, meta2, meta3);
    console.log();
    console.log(`${C.darkGray}${divider}${C.reset}`);
}

function renderDivider() {
    const termWidth = process.stdout.columns || 80;
    const dividerLen = Math.max(20, Math.min(termWidth - 2, 68));
    const divider = '─'.repeat(dividerLen);
    console.log(`${C.darkGray}${divider}${C.reset}`);
}

// Readline UI Setup
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.bold}${C.green}❯ ${C.reset}`
});

// Robust Parser to extract tool calls from any LLM response text or markdown blocks
function extractFallbackToolCalls(responseText) {
    if (!responseText) return [];
    const calls = [];
    let cleaned = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    function processCandidate(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach(processCandidate);
            return;
        }
        // Pattern 1: { action: 'tool_call', calls: [...] }
        if (obj.action === 'tool_call' && Array.isArray(obj.calls)) {
            obj.calls.forEach(c => {
                const name = c.tool || c.name;
                if (name) {
                    calls.push({
                        id: `call_json_${Date.now()}_${calls.length}`,
                        name,
                        args: c.args || c.parameters || c.arguments || {}
                    });
                }
            });
            return;
        }
        // Pattern 2: { tool: "open_binary", path: "..." } or { tool: "...", args: {...} }
        if (obj.tool && typeof obj.tool === 'string') {
            const { tool, ...rest } = obj;
            const args = (rest.args && typeof rest.args === 'object') ? rest.args : rest;
            calls.push({
                id: `call_json_${Date.now()}_${calls.length}`,
                name: tool,
                args
            });
            return;
        }
        // Pattern 3: { name: "inspect_apk", arguments: {...} }
        if (obj.name && typeof obj.name === 'string' && (obj.arguments || obj.parameters || obj.args)) {
            const rawArgs = obj.arguments || obj.parameters || obj.args;
            calls.push({
                id: `call_json_${Date.now()}_${calls.length}`,
                name: obj.name,
                args: typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
            });
            return;
        }
        // Pattern 4: { function: "...", arguments: {...} }
        if (obj.function && (typeof obj.function === 'string' || obj.function.name)) {
            const name = typeof obj.function === 'string' ? obj.function : obj.function.name;
            const rawArgs = obj.function?.arguments || obj.arguments || obj.parameters || {};
            calls.push({
                id: `call_json_${Date.now()}_${calls.length}`,
                name,
                args: typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
            });
            return;
        }
    }

    // A. Check markdown code blocks: ```json ... ``` or ``` ... ```
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let match;
    while ((match = codeBlockRegex.exec(cleaned)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            processCandidate(parsed);
        } catch(e) {}
    }
    if (calls.length > 0) return calls;

    // B. Check full-span JSON object
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e !== -1 && s < e) {
        try {
            const parsed = JSON.parse(cleaned.substring(s, e + 1));
            processCandidate(parsed);
        } catch(e) {
            // C. Line or regex-based JSON scan
            const objRegex = /\{[\s\S]*?\}/g;
            let m;
            while ((m = objRegex.exec(cleaned)) !== null) {
                try {
                    const candidate = JSON.parse(m[0]);
                    processCandidate(candidate);
                } catch(err) {}
            }
        }
    }

    if (calls.length > 0) return calls;

    // D. Fallback for models outputting markdown bash blocks instead of calling execute_command
    const bashBlockRegex = /```(?:bash|sh|shell|zsh)\s*([\s\S]*?)\s*```/gi;
    let bMatch;
    const bashCmds = [];
    while ((bMatch = bashBlockRegex.exec(cleaned)) !== null) {
        const rawBlock = bMatch[1].trim();
        const executableLines = rawBlock.split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
        if (executableLines.length > 0) {
            bashCmds.push(rawBlock);
        }
    }
    if (bashCmds.length > 0) {
        calls.push({
            id: `call_bash_${Date.now()}`,
            name: 'execute_command',
            args: { command: bashCmds.join('\n') }
        });
    }

    return calls;
}

// Autonomous Multi-Turn Execution Loop
async function runAgent(promptText) {
    if (isProcessing) return;
    isProcessing = true;
    currentAbortController = new AbortController();

    chatHistory.push({ role: 'user', content: promptText });
    saveSession();

    let turnsCounter = 0;
    let completed = false;

    while (!completed && turnsCounter < CEILING_TURNS) {
        turnsCounter++;
        let streamedFirstToken = false;
        let inThinkingMode = false;
        let responseText = '';
        let toolCalls = [];

        spinner.start('Cogitating');

        try {
            let systemPrompt = buildSystemPrompt();
            const memoryCheckRegex = /(what\s+(did\s+)?i\s+(ask|say|tell)|do\s+you\s+(have\s+)?memory|recall|remember|previous\s+message)/i;
            if (memoryCheckRegex.test(promptText)) {
                systemPrompt += `\n\n=== DIRECT MEMORY RECALL INSTRUCTION ===\nThe user is asking what they asked or said earlier in this active session.\nReview the previous user messages in the chat history provided above and answer directly by stating their earlier prompts.\nNEVER recite a disclaimer claiming that you have no memory or that each session starts fresh.\n========================================\n`;
            }

            const result = await api.callAI({
                activeModel,
                chatHistory,
                promptText: null, // fullHistory is constructed from chatHistory
                SYSTEM_PROMPT: systemPrompt,
                tools: tools.schemas,
                signal: currentAbortController.signal,
                onToken: (delta, isThinking = false) => {
                    if (isThinking) {
                        if (!streamedFirstToken) {
                            streamedFirstToken = true;
                            spinner.stop(true);
                            process.stdout.write(`\n${C.gray}${C.italic}Thinking...${C.reset}\n`);
                            inThinkingMode = true;
                        }
                        process.stdout.write(`${C.darkGray}${delta}${C.reset}`);
                    } else {
                        if (inThinkingMode) {
                            inThinkingMode = false;
                            process.stdout.write(`\n\n${C.reset}`);
                        }
                        if (!streamedFirstToken) {
                            streamedFirstToken = true;
                            spinner.stop(true);
                            process.stdout.write('\n');
                        }
                        process.stdout.write(delta);
                    }
                }
            });

            spinner.stop(true);

            responseText = result.text || '';
            toolCalls = result.toolCalls || [];

            // Add final newline if streamed
            if (streamedFirstToken) {
                process.stdout.write('\n');
            }

            // Fallback: Check if response text has embedded JSON tool call
            if (toolCalls.length === 0 && responseText) {
                try {
                    const fallbackCalls = extractFallbackToolCalls(responseText);
                    if (fallbackCalls.length > 0) {
                        toolCalls = fallbackCalls;
                    }
                } catch(err) {}
            }

            // If no tool calls were made, the assistant is done
            if (toolCalls.length === 0) {
                if (!streamedFirstToken && responseText) {
                    console.log(`\n${responseText}\n`);
                }
                chatHistory.push({ role: 'assistant', content: responseText });
                saveSession();
                completed = true;
                break;
            }

            // Record assistant message with tool calls
            chatHistory.push({
                role: 'assistant',
                content: responseText || '',
                tool_calls: toolCalls
            });

            // Execute each tool call
            for (const call of toolCalls) {
                let callArgs = call.args;
                if (typeof callArgs === 'string') {
                    try { callArgs = JSON.parse(callArgs); } catch(e) { callArgs = { raw: callArgs }; }
                }
                call.args = callArgs || {};

                const argPreview = Object.entries(call.args)
                    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                    .join(', ');
                const truncatedArgs = argPreview.length > 60 ? argPreview.substring(0, 57) + '...' : argPreview;

                console.log(`\n${C.bold}${C.yellow}● ${call.name}${C.reset}${C.gray}(${truncatedArgs})${C.reset}`);

                spinner.start(`Executing ${call.name}`);
                const toolOutput = await tools.execute(call.name, call.args);
                spinner.stop(true);

                // Format tool result output snippet in Claude Code style (⎿ ...)
                const lines = toolOutput.trim().split('\n');
                const snippet = lines.slice(0, 5).join('\n  ⎿  ');
                const extra = lines.length > 5 ? `\n  ${C.dim}... (${lines.length - 5} more lines)${C.reset}` : '';

                console.log(`  ${C.dim}⎿  ${snippet}${extra}${C.reset}`);

                chatHistory.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: toolOutput
                });
            }

            saveSession();

        } catch (err) {
            spinner.stop(true);
            if (err.name === 'AbortError' || currentAbortController.signal.aborted) {
                console.log(`\n${C.yellow}⚠ Operation cancelled by user.${C.reset}\n`);
            } else {
                console.log(`\n  ${C.red}⎿  API Error: ${err.message}${C.reset}\n`);
            }
            completed = true;
            break;
        }
    }

    if (turnsCounter >= CEILING_TURNS) {
        console.log(`\n${C.yellow}⚠ Max autonomous turn ceiling (${CEILING_TURNS}) reached.${C.reset}\n`);
    }

    renderDivider();
    isProcessing = false;
    currentAbortController = null;
    rl.prompt();
}

// Interactive Slash Commands Handler
async function handleSlashCommand(input) {
    const parts = input.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = input.trim().substring(command.length).trim();

    // 1. HELP
    if (command === '/help' || command === '/?' || command === '/') {
        console.log(`\n${C.bold}Available Commands:${C.reset}`);
        console.log(`  ${C.green}/model${C.reset} [id]                Switch or view active model (retains shared memory)`);
        console.log(`  ${C.green}/models${C.reset}                    List all configured models`);
        console.log(`  ${C.green}/session${C.reset} [subcommand]      Manage dedicated session directories & memories`);
        console.log(`      ${C.dim}/session (info) | /session list | /session switch <id> | /session new [name]${C.reset}`);
        console.log(`  ${C.green}/endpoint${C.reset} [url]            View or set API endpoint URL`);
        console.log(`  ${C.green}/key${C.reset} [api_key]             View or set API Key`);
        console.log(`  ${C.green}/config${C.reset}                  Display current configuration`);
        console.log(`  ${C.green}/add-model${C.reset}                Launch interactive model setup wizard`);
        console.log(`  ${C.green}/del-model${C.reset}                Delete a configured model`);
        console.log(`  ${C.green}/skills${C.reset}                   List available skills`);
        console.log(`  ${C.green}/<skill_name> <prompt>${C.reset}     Execute task using specific skill instructions`);
        console.log(`  ${C.green}/rea${C.reset} [target] [prompt]      Launch Reverse Engineering workflow directly`);
        console.log(`  ${C.green}/noskill${C.reset}                  Clear active skill guidelines`);
        console.log(`  ${C.green}/tools${C.reset}                    List all available tools`);
        console.log(`  ${C.green}/tasks${C.reset} [list|logs <id>]    Manage background commands & tasks`);
        console.log(`  ${C.green}/clear${C.reset}                    Clear conversation context & screen`);
        console.log(`  ${C.green}/logo${C.reset} [1-5|name]             Switch terminal header logo style (5 unique styles)`);
        console.log(`  ${C.green}/compact${C.reset}                  Compact conversation to save tokens`);
        console.log(`  ${C.green}/status${C.reset}                   Show session statistics and memory`);
        console.log(`  ${C.green}/exit${C.reset} | ${C.green}/quit${C.reset}             Exit AxilO\n`);
        return;
    }

    // 2. CLEAR
    if (command === '/clear') {
        chatHistory = [];
        activeSkillContext = null;
        saveSession();
        console.clear();
        renderHeaderBanner();
        return;
    }

    // 2.0 LOGO / STYLE SWITCHER: /logo [1-5 | name]
    if (command === '/logo' || command === '/style') {
        const styleKeys = Object.keys(LOGO_STYLES);
        if (!args) {
            console.log(`\n${C.bold}Distinctive AxilO Logo Signatures:${C.reset}`);
            styleKeys.forEach((k, idx) => {
                const isAct = (agentConfig.logoStyle === k);
                const marker = isAct ? ` ${C.green}● (active)${C.reset}` : ` ${C.gray}○${C.reset}`;
                console.log(`  [${idx + 1}] ${C.cyan}${k.toUpperCase().padEnd(12)}${C.reset} · ${LOGO_STYLES[k].name}${marker}`);
            });
            console.log(`\n${C.gray}Switch logo style with: ${C.green}/logo <1-5|name>${C.reset}\n`);
            return;
        }

        const inputStyle = args.trim().toLowerCase();
        let selectedKey = null;

        const num = parseInt(inputStyle, 10);
        if (!isNaN(num) && num >= 1 && num <= styleKeys.length) {
            selectedKey = styleKeys[num - 1];
        } else {
            selectedKey = styleKeys.find(k => k === inputStyle || LOGO_STYLES[k].name.toLowerCase().includes(inputStyle));
        }

        if (selectedKey) {
            agentConfig.logoStyle = selectedKey;
            saveConfig();
            console.log(`\n${C.green}✔ Active logo set to: ${C.bold}${LOGO_STYLES[selectedKey].name}${C.reset}\n`);
            renderHeaderBanner();
        } else {
            console.log(`\n${C.red}Unknown logo style: "${args}". Valid options: ${styleKeys.join(', ')} or 1-${styleKeys.length}.${C.reset}\n`);
        }
        return;
    }

    // 2.1 SESSION MANAGEMENT: /session [list|switch|new|status]
    if (command === '/session' || command === '/sessions') {
        const subArgs = args.split(/\s+/);
        const subCmd = subArgs[0]?.toLowerCase();
        const param = subArgs.slice(1).join(' ').trim();

        if (!subCmd || subCmd === 'info' || subCmd === 'dir') {
            const memPath = path.join(currentSessionDir || '', 'memory.json');
            let memSize = '0 B';
            if (fs.existsSync(memPath)) {
                memSize = (fs.statSync(memPath).size / 1024).toFixed(1) + ' KB';
            }
            console.log(`\n${C.bold}Current Session Details:${C.reset}`);
            console.log(`  Session ID:   ${C.green}${currentSessionMeta?.id || 'None'}${C.reset}`);
            console.log(`  Directory:    ${C.cyan}${currentSessionDir || 'None'}${C.reset}`);
            console.log(`  Active Model: ${C.green}${activeModel.name || activeModel.id}${C.reset}`);
            console.log(`  Models Used:  ${currentSessionMeta?.modelsUsed?.join(', ') || activeModel.id}`);
            console.log(`  Context Msgs: ${chatHistory.length}`);
            console.log(`  Memory File:  ${memPath} (${memSize})`);
            console.log(`\nSubcommands: ${C.green}/session list${C.reset}, ${C.green}/session switch <id_or_num>${C.reset}, ${C.green}/session new [name]${C.reset}\n`);
            return;
        }

        if (subCmd === 'list' || subCmd === 'ls') {
            const list = listSessions();
            console.log(`\n${C.bold}Dedicated Session Directories (${list.length}):${C.reset}`);
            if (list.length === 0) {
                console.log(`  ${C.gray}No saved sessions found.${C.reset}\n`);
                return;
            }
            list.forEach((s, idx) => {
                const isCur = s.dir === currentSessionDir ? ` ${C.green}● (active)${C.reset}` : '';
                const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : 'N/A';
                console.log(`  [${idx + 1}] ${C.bold}${s.id}${C.reset}${isCur}`);
                console.log(`      Path: ${C.dim}${s.dir}${C.reset}`);
                console.log(`      Messages: ${s.messageCount} | Models: ${s.modelsUsed.join(', ') || s.activeModel} | Updated: ${dateStr}`);
            });
            console.log(`\nType ${C.green}/session switch <id_or_number>${C.reset} to switch session.\n`);
            return;
        }

        if (subCmd === 'switch' || subCmd === 'load' || subCmd === 'resume') {
            if (!param) {
                console.log(`\n${C.yellow}Usage: /session switch <id_or_number>${C.reset}\n`);
                return;
            }
            const list = listSessions();
            let targetDir = null;
            const idx = parseInt(param, 10) - 1;
            if (!isNaN(idx) && idx >= 0 && idx < list.length) {
                targetDir = list[idx].dir;
            } else {
                const found = list.find(s => s.id === param || s.id.toLowerCase().includes(param.toLowerCase()));
                if (found) targetDir = found.dir;
                else if (fs.existsSync(param)) targetDir = param;
                else if (fs.existsSync(path.join(SESSIONS_DIR, param))) targetDir = path.join(SESSIONS_DIR, param);
            }

            if (targetDir && loadSession(targetDir)) {
                console.log(`\n${C.green}✔ Switched to dedicated session directory:${C.reset}`);
                console.log(`  ${C.cyan}${currentSessionDir}${C.reset}`);
                console.log(`  Loaded ${chatHistory.length} messages from memory.json.\n`);
            } else {
                console.log(`\n${C.red}✖ Could not find or load session: ${param}${C.reset}\n`);
            }
            return;
        }

        if (subCmd === 'new' || subCmd === 'create') {
            saveSession();
            createSession(param || null);
            console.log(`\n${C.green}✔ Created new dedicated session directory:${C.reset}`);
            console.log(`  ${C.cyan}${currentSessionDir}${C.reset}`);
            console.log(`  Fresh memory.json initialized for active model (${activeModel.id}).\n`);
            return;
        }
    }

    // 3. EXIT / QUIT
    if (command === '/exit' || command === '/quit') {
        saveSession();
        console.log(`\n${C.green}Session memory saved. Goodbye!${C.reset}\n`);
        process.exit(0);
    }

    // 4. MODEL / MODELS
    if (command === '/models') {
        console.log(`\n${C.bold}Configured Models in models.json:${C.reset}`);
        availableModels.forEach((m, i) => {
            const isCur = m.id === activeModel.id ? `${C.green}● (active)${C.reset}` : ' ';
            console.log(`  [${i + 1}] ${C.bold}${m.name}${C.reset} ${C.gray}(${m.id})${C.reset} ${isCur}`);
            console.log(`      Endpoint: ${C.dim}${m.endpoint}${C.reset}`);
        });
        console.log();
        return;
    }

    if (command === '/model') {
        if (!args) {
            console.log(`\n${C.bold}Current Active Model:${C.reset} ${activeModel.name} (${activeModel.id})`);
            console.log(`  ${C.dim}Endpoint: ${activeModel.endpoint}${C.reset}`);
            console.log(`  ${C.dim}Session Memory: ${currentSessionDir}/memory.json${C.reset}`);
            console.log(`To switch, type: ${C.green}/model <id_or_number>${C.reset} or see ${C.green}/models${C.reset}\n`);
            return;
        }

        let switched = false;
        const idx = parseInt(args, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < availableModels.length) {
            activeModel = availableModels[idx];
            switched = true;
        } else {
            const found = availableModels.find(m => m.id.toLowerCase() === args.toLowerCase() || m.name.toLowerCase().includes(args.toLowerCase()));
            if (found) {
                activeModel = found;
                switched = true;
            } else {
                activeModel.id = args;
                saveModels();
                switched = true;
            }
        }

        if (switched) {
            saveSession();
            console.log(`\n${C.green}✔ Switched model to: ${activeModel.name || activeModel.id} (${activeModel.id})${C.reset}`);
            console.log(`  ${C.gray}Session memory preserved & shared across models in:${C.reset}`);
            console.log(`  ${C.cyan}${currentSessionDir}/memory.json${C.reset}\n`);
            renderHeaderBanner();
            return;
        }
    }

    // 5. ENDPOINT
    if (command === '/endpoint' || command === '/url') {
        if (!args) {
            console.log(`\n${C.bold}Current Endpoint:${C.reset} ${activeModel.endpoint}\n`);
            return;
        }
        activeModel.endpoint = args;
        if (args.includes('agentrouter.org')) activeModel.provider = 'agentrouter';
        else if (args.includes('googleapis.com')) activeModel.provider = 'google';
        else if (args.includes('anthropic.com')) activeModel.provider = 'anthropic';
        else activeModel.provider = 'openai';
        saveModels();
        console.log(`\n${C.green}✔ Endpoint updated to: ${args}${C.reset}\n`);
        return;
    }

    // 6. KEY
    if (command === '/key') {
        if (!args) {
            const masked = activeModel.apiKey ? `${activeModel.apiKey.slice(0, 7)}...${activeModel.apiKey.slice(-6)}` : 'None';
            console.log(`\n${C.bold}Current API Key:${C.reset} ${masked}\n`);
            return;
        }
        activeModel.apiKey = args;
        saveModels();
        console.log(`\n${C.green}✔ API Key updated successfully.${C.reset}\n`);
        return;
    }

    // 7. CONFIG
    if (command === '/config' || command === '/settings') {
        const masked = activeModel.apiKey ? `${activeModel.apiKey.slice(0, 7)}...${activeModel.apiKey.slice(-6)}` : 'None';
        console.log(`\n${C.bold}Active Configuration:${C.reset}`);
        console.log(`  Model:       ${C.green}${activeModel.name}${C.reset} (${activeModel.id})`);
        console.log(`  Endpoint:    ${C.cyan}${activeModel.endpoint}${C.reset}`);
        console.log(`  Provider:    ${activeModel.provider || 'auto'}`);
        console.log(`  API Key:     ${masked}`);
        console.log(`  Temperature: ${activeModel.temperature ?? 0.3}`);
        console.log(`  Max Tokens:  ${activeModel.maxTokens ?? 4096}`);
        console.log(`  Stream:      ${activeModel.stream ?? true}`);
        console.log(`  Tools Count: ${tools.schemas.length}`);
        console.log(`  Working Dir: ${process.cwd()}\n`);
        return;
    }

    // 8. ADD MODEL
    if (command === '/add-model') {
        const addScript = path.join(BASE_DIR, 'add_model.js');
        if (fs.existsSync(addScript)) {
            rl.pause();
            execSync(`node "${addScript}"`, { stdio: 'inherit' });
            loadModels();
            rl.resume();
        }
        return;
    }

    // 9. DEL MODEL
    if (command === '/del-model') {
        const delScript = path.join(BASE_DIR, 'del_model.js');
        if (fs.existsSync(delScript)) {
            rl.pause();
            execSync(`node "${delScript}"`, { stdio: 'inherit' });
            loadModels();
            rl.resume();
        }
        return;
    }

    // 10. TOOLS
    if (command === '/tools') {
        console.log(`\n${C.bold}Registered Agent Tools (${tools.schemas.length}):${C.reset}`);
        tools.schemas.forEach(t => {
            console.log(`  ${C.green}● ${t.name}${C.reset}: ${C.dim}${t.description}${C.reset}`);
        });
        console.log();
        return;
    }

    // 10.1 TASKS
    if (command === '/tasks' || command === '/task') {
        const subArgs = args.split(/\s+/);
        const subAction = subArgs[0]?.toLowerCase() || 'list';
        const targetId = subArgs[1];
        if (subAction === 'logs' || subAction === 'log') {
            const out = await tools.execute('manage_task', { action: 'logs', task_id: targetId, tail_lines: 40 });
            console.log(`\n${out}\n`);
        } else if (subAction === 'kill' || subAction === 'stop') {
            const out = await tools.execute('manage_task', { action: 'kill', task_id: targetId });
            console.log(`\n${out}\n`);
        } else {
            const out = await tools.execute('manage_task', { action: 'list' });
            console.log(`\n${out}\n`);
        }
        return;
    }

    // 10.2 NOSKILL
    if (command === '/noskill' || command === '/clearskill') {
        activeSkillContext = null;
        console.log(`\n${C.green}✔ Active skill context cleared. Standard terminal tools restored.${C.reset}\n`);
        return;
    }

    // 11. SKILLS
    if (command === '/skills') {
        const skills = getAvailableSkills();
        console.log(`\n${C.bold}Available Skills (${skills.length}):${C.reset}`);
        skills.forEach(s => {
            console.log(`  ${C.cyan}/${s.name}${C.reset}  ${C.dim}(${s.path})${C.reset}`);
        });
        console.log(`\nUsage: Type ${C.green}/<skill_name> <prompt>${C.reset} to run with that skill.\n`);
        return;
    }

    // 12. STATUS
    if (command === '/status') {
        const mem = process.memoryUsage();
        const memPath = path.join(currentSessionDir || '', 'memory.json');
        let memSize = '0 B';
        if (fs.existsSync(memPath)) {
            memSize = (fs.statSync(memPath).size / 1024).toFixed(1) + ' KB';
        }
        console.log(`\n${C.bold}Session & System Status:${C.reset}`);
        console.log(`  Session ID:          ${C.green}${currentSessionMeta?.id || 'None'}${C.reset}`);
        console.log(`  Dedicated Directory: ${C.cyan}${currentSessionDir || 'None'}${C.reset}`);
        console.log(`  Memory File:         ${memPath} (${memSize})`);
        console.log(`  Messages in Memory:  ${chatHistory.length}`);
        console.log(`  Active Model:        ${activeModel.name} (${activeModel.id})`);
        console.log(`  Models in Session:   ${currentSessionMeta?.modelsUsed?.join(', ') || activeModel.id}`);
        console.log(`  Active Skill:        ${activeSkillContext ? activeSkillContext.name : 'None'}`);
        console.log(`  Process Memory:      ${(mem.rss / 1024 / 1024).toFixed(1)} MB (RSS)`);
        console.log(`  Node Version:        ${process.version}\n`);
        return;
    }

    // 13. COMPACT
    if (command === '/compact') {
        if (chatHistory.length <= 2) {
            console.log(`\n${C.gray}Conversation is already compact.${C.reset}\n`);
            return;
        }
        spinner.start('Compacting conversation');
        try {
            const summaryPrompt = `Summarize the key facts, decisions, files, and objectives from this conversation in 3 concise bullet points so context can be preserved.`;
            const summaryRes = await api.callAI({
                activeModel,
                chatHistory,
                promptText: summaryPrompt,
                SYSTEM_PROMPT: "You are a concise conversation summarizer."
            });
            spinner.stop(true);
            chatHistory = [
                { role: 'user', content: '[Previous Conversation Summary]:\n' + summaryRes.text }
            ];
            saveSession();
            console.log(`\n${C.green}✔ Conversation successfully compacted.${C.reset}\n`);
        } catch (e) {
            spinner.stop(true);
            console.log(`\n${C.red}✖ Compacting failed: ${e.message}${C.reset}\n`);
        }
        return;
    }

    // 14. DYNAMIC SKILL INVOCATION: /<skill_name> [args]
    const skillName = command.replace(/^\//, '');
    const skill = loadSkill(skillName);

    if (skill) {
        activeSkillContext = skill;
        console.log(`\n${C.coral}● Skill Loaded: ${skill.name}${C.reset}`);

        if (!args) {
            // Skill specific interactive prompting matching Claude Code
            if (skill.name.includes('reverse-engineer') || skill.name === 'rea') {
                console.log(`\n${C.bold}● What artifact or application should I reverse engineer?${C.reset}`);
                console.log(`  Provide its local path and the behavior or feature you want investigated.\n`);
            } else {
                console.log(`  ${C.gray}Skill instructions injected into active context.${C.reset}`);
                console.log(`  Please enter your prompt for this skill:\n`);
            }
            return;
        }

        // Direct execution with prompt arguments
        await runAgent(args);
        return;
    }

    console.log(`\n${C.red}✖ Unknown command: ${command}${C.reset}. Type ${C.green}/help${C.reset} for available commands.\n`);
}

// Line Input Handler
rl.on('line', async (line) => {
    const cleanInput = line.trim();
    if (!cleanInput) {
        rl.prompt();
        return;
    }

    if (cleanInput.startsWith('/')) {
        await handleSlashCommand(cleanInput);
        if (!isProcessing) rl.prompt();
        return;
    }

    await runAgent(cleanInput);
});

// Non-Interactive / CLI Argument Handling
async function main() {
    loadModels();

    const argv = process.argv.slice(2);
    let promptArg = null;
    let sessionArg = null;
    let resumeLatest = false;
    let forceNew = false;

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-p' || argv[i] === '--print' || argv[i] === '--prompt') {
            promptArg = argv[i + 1];
            i++;
        } else if (argv[i] === '--model' && argv[i + 1]) {
            const modelArg = argv[i + 1];
            const found = availableModels.find(m => m.id.toLowerCase() === modelArg.toLowerCase() || m.name.toLowerCase().includes(modelArg.toLowerCase()));
            if (found) {
                activeModel = { ...found };
            } else {
                activeModel = {
                    name: modelArg,
                    id: modelArg,
                    endpoint: activeModel?.endpoint || 'https://agentrouter.org',
                    apiKey: activeModel?.apiKey || 'sk-xz0htv16oEc2XjwyYcd699XvyJ3IFtGXeUo5XTUk079H5Z5B',
                    provider: 'agentrouter'
                };
            }
            i++;
        } else if (argv[i] === '--endpoint' && argv[i + 1]) {
            activeModel.endpoint = argv[i + 1];
            i++;
        } else if (argv[i] === '--key' && argv[i + 1]) {
            activeModel.apiKey = argv[i + 1];
            i++;
        } else if ((argv[i] === '--session' || argv[i] === '-s') && argv[i + 1]) {
            sessionArg = argv[i + 1];
            i++;
        } else if (argv[i] === '--continue' || argv[i] === '-c') {
            resumeLatest = true;
        } else if (argv[i] === '--new' || argv[i] === '-n') {
            forceNew = true;
        } else if (!argv[i].startsWith('-') && !promptArg) {
            promptArg = argv.slice(i).join(' ');
            break;
        }
    }

    // Initialize dedicated session directory & shared memory
    if (sessionArg) {
        const directPath = fs.existsSync(sessionArg) ? sessionArg : path.join(SESSIONS_DIR, sessionArg);
        if (fs.existsSync(directPath)) {
            loadSession(directPath);
        } else {
            createSession(sessionArg);
        }
    } else if (resumeLatest && !forceNew) {
        const list = listSessions();
        if (list.length > 0) {
            loadSession(list[0].dir);
        } else {
            createSession();
        }
    } else {
        createSession();
    }

    // If a prompt was provided via command line, execute single-shot and exit
    if (promptArg) {
        if (promptArg.startsWith('/')) {
            await handleSlashCommand(promptArg);
            process.exit(0);
        } else {
            await runAgent(promptArg);
            saveSession();
            process.exit(0);
        }
    }

    // Interactive Mode
    console.clear();
    renderHeaderBanner();
    rl.prompt();
}

main().catch(err => {
    console.error(`\n${C.red}Fatal initialization error: ${err.message}${C.reset}`);
    process.exit(1);
});
