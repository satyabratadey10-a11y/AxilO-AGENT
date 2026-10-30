const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { exec, spawn } = require('node:child_process');
const util = require('node:util');

const execAsync = util.promisify(exec);

// Background Tasks Registry
const TASKS_DIR = path.join(os.homedir(), '.axilo', 'tasks');
if (!fsSync.existsSync(TASKS_DIR)) {
    fsSync.mkdirSync(TASKS_DIR, { recursive: true });
}
const backgroundTasks = new Map();

const schemas = [
    {
        name: 'execute_command',
        description: 'Execute shell commands in the workspace. Returns command output, exit status, and duration. Supports synchronous execution and long-running background tasks.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The bash command line string to execute' },
                is_background: { type: 'boolean', description: 'Set true to run in the background without blocking, returning a task ID immediately' },
                timeout_ms: { type: 'number', description: 'Optional timeout in milliseconds for synchronous commands (default 60000)' }
            },
            required: ['command']
        }
    },
    {
        name: 'manage_task',
        description: 'Manage background tasks: list running tasks, check status, inspect recent logs, or terminate a task.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'status', 'logs', 'kill'], description: 'Action to perform' },
                task_id: { type: 'string', description: 'The task ID to manage (required for status, logs, kill)' },
                tail_lines: { type: 'number', description: 'Number of log lines to inspect (default 30)' }
            },
            required: ['action']
        }
    },
    {
        name: 'open_binary',
        description: 'Inspects a binary, Android APK, or compiled artifact: extracts structure, manifest, DEX units, and strings.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to binary or APK file' },
                provider_id: { type: 'string', description: 'Target system or format (e.g. "android", "native", "managed")' }
            },
            required: ['path']
        }
    },
    {
        name: 'analyze_function',
        description: 'Locates and analyzes methods, functions, or symbol references in an APK or binary.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to APK or binary' },
                query: { type: 'string', description: 'Class name, method name, or symbol keyword to analyze' }
            },
            required: ['path', 'query']
        }
    },
    {
        name: 'search_android_classes',
        description: 'Searches for class names, activities, or dialog components inside an Android APK package.',
        parameters: {
            type: 'object',
            properties: {
                apk_path: { type: 'string', description: 'Path to the APK file' },
                query: { type: 'string', description: 'Class, activity, or keyword to search' }
            },
            required: ['apk_path', 'query']
        }
    },
    {
        name: 'read_file',
        description: 'Reads local file contents safely with optional line number filtering.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute or relative path to the file' },
                start_line: { type: 'number', description: 'Optional 1-based start line (inclusive)' },
                end_line: { type: 'number', description: 'Optional 1-based end line (inclusive)' }
            },
            required: ['path']
        }
    },
    {
        name: 'write_file',
        description: 'Creates a new file or overwrites an existing file with the provided contents.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path of the file to create or overwrite' },
                content: { type: 'string', description: 'The full text contents to write' },
                append: { type: 'boolean', description: 'If true, append to existing file instead of overwriting' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'patch_file',
        description: 'Surgically modifies a file by replacing an exact block of existing text with new text.',
        parameters: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Target file path' },
                search_text: { type: 'string', description: 'The EXACT original code block or text to replace' },
                replace_text: { type: 'string', description: 'The replacement text' }
            },
            required: ['file_path', 'search_text', 'replace_text']
        }
    },
    {
        name: 'list_directory',
        description: 'Lists all files and subdirectories in a given folder with metadata.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path to list (default current directory)' }
            },
            required: ['path']
        }
    },
    {
        name: 'web_search',
        description: 'Searches the internet for real-time information, documentation, and answers.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search keywords or query' }
            },
            required: ['query']
        }
    },
    {
        name: 'fetch_web_content',
        description: 'Fetches raw HTML or text data from a public URL.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The HTTP or HTTPS URL to fetch' }
            },
            required: ['url']
        }
    },
    {
        name: 'inspect_apk',
        description: 'Analyzes an Android APK package: inspects manifest, DEX classes, assets, or force update triggers.',
        parameters: {
            type: 'object',
            properties: {
                apk_path: { type: 'string', description: 'Path to the .apk file' },
                action: { 
                    type: 'string', 
                    enum: ['info', 'list_dex', 'extract_manifest', 'search_strings'],
                    description: 'Inspection action to perform'
                },
                query: { type: 'string', description: 'Optional search keyword when action is search_strings' }
            },
            required: ['apk_path', 'action']
        }
    },
    {
        name: 'import_skill',
        description: 'Dynamically loads a skill markdown file from ./skills or system skill directories.',
        parameters: {
            type: 'object',
            properties: {
                skill_name: { type: 'string', description: 'Name of the skill without .md extension' }
            },
            required: ['skill_name']
        }
    },
    {
        name: 'update_memory',
        description: 'Updates persistent core memory file (imp_memo.md) so rules and lessons persist across sessions.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'The memory content or rule to store' },
                mode: { type: 'string', enum: ['append', 'overwrite'], description: 'Whether to append or overwrite' }
            },
            required: ['content', 'mode']
        }
    },
    {
        name: 'reason',
        description: 'Explicitly logs intermediate reasoning, plans, or calculation steps before taking action.',
        parameters: {
            type: 'object',
            properties: {
                thought_process: { type: 'string', description: 'Detailed reasoning notes' }
            },
            required: ['thought_process']
        }
    }
];

function capTools128(toolList) {
    if (!toolList || !Array.isArray(toolList) || toolList.length <= 128) return toolList;
    return toolList.slice(0, 128);
}

async function executeTool(rawToolName, rawArgs) {
    let toolName = (rawToolName || '').trim();
    let args = rawArgs || {};

    // Normalize arguments if passed as JSON string
    if (typeof args === 'string') {
        try {
            args = JSON.parse(args);
        } catch(e) {
            args = { input: args };
        }
    }

    // Aliases normalization
    if (['bash', 'sh', 'shell', 'cmd', 'run_command', 'exec'].includes(toolName)) {
        toolName = 'execute_command';
        if (!args.command && (args.cmd || args.CommandLine || args.script)) {
            args.command = args.cmd || args.CommandLine || args.script;
        }
    }

    try {
        // 1. EXECUTE COMMAND (Sync or Background)
        if (toolName === 'execute_command') {
            const cmd = args.command || args.cmd || '';
            if (!cmd) return 'Error: No command provided to execute_command.';

            const isBg = !!(args.is_background || args.background || args.IsDaemon);
            if (isBg) {
                const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                const logFile = path.join(TASKS_DIR, `${taskId}.log`);
                const outStream = fsSync.openSync(logFile, 'a');

                const child = spawn('bash', ['-c', cmd], {
                    cwd: process.cwd(),
                    detached: true,
                    stdio: ['ignore', outStream, outStream]
                });
                child.unref();

                const taskInfo = {
                    id: taskId,
                    pid: child.pid,
                    command: cmd,
                    startTime: new Date().toISOString(),
                    status: 'RUNNING',
                    logFile
                };
                backgroundTasks.set(taskId, taskInfo);

                child.on('exit', (code, signal) => {
                    taskInfo.status = code === 0 ? 'COMPLETED' : `FAILED (exit ${code})`;
                    taskInfo.endTime = new Date().toISOString();
                });

                return `[BACKGROUND TASK LAUNCHED]\nTaskId: ${taskId}\nCommand: ${cmd}\nLogFile: ${logFile}\nStatus: Running in background. You can proceed with other tasks or check output via 'manage_task'.`;
            }

            const timeout = args.timeout_ms || 60000;
            const startTime = Date.now();
            const { stdout, stderr } = await execAsync(cmd, {
                timeout,
                maxBuffer: 1024 * 1024 * 10,
                cwd: process.cwd()
            });
            const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
            let out = (stdout || '') + (stderr ? `\n[STDERR]:\n${stderr}` : '');
            out = out.trim();
            return out ? `[Exit 0 in ${durationSec}s]\n${out}` : `(Command completed in ${durationSec}s with no output)`;
        }

        // 2. MANAGE TASK
        if (toolName === 'manage_task' || toolName === 'tasks') {
            const action = (args.action || 'list').toLowerCase();
            const taskId = args.task_id || args.taskId;

            if (action === 'list') {
                if (backgroundTasks.size === 0) {
                    return 'No active background tasks registered in this session.';
                }
                const rows = [];
                for (const [id, t] of backgroundTasks.entries()) {
                    rows.push(`- [${t.status}] ID: ${id} | PID: ${t.pid || 'N/A'} | Cmd: "${t.command.slice(0, 40)}" | Log: ${t.logFile}`);
                }
                return `=== Registered Background Tasks (${backgroundTasks.size}) ===\n` + rows.join('\n');
            }

            if (action === 'status') {
                if (!taskId || !backgroundTasks.has(taskId)) return `Error: Task ID "${taskId}" not found.`;
                const t = backgroundTasks.get(taskId);
                return `=== Task Status: ${taskId} ===\nStatus: ${t.status}\nCommand: ${t.command}\nStarted: ${t.startTime}\nLog: ${t.logFile}`;
            }

            if (action === 'logs') {
                if (!taskId || !backgroundTasks.has(taskId)) return `Error: Task ID "${taskId}" not found.`;
                const t = backgroundTasks.get(taskId);
                if (!fsSync.existsSync(t.logFile)) return `Log file not found at ${t.logFile}`;
                const raw = await fs.readFile(t.logFile, 'utf8');
                const lines = raw.split('\n');
                const n = args.tail_lines || 30;
                const tail = lines.slice(-n).join('\n');
                return `=== Logs for Task ${taskId} (last ${n} lines) ===\n${tail || '(Log is currently empty)'}`;
            }

            if (action === 'kill') {
                if (!taskId || !backgroundTasks.has(taskId)) return `Error: Task ID "${taskId}" not found.`;
                const t = backgroundTasks.get(taskId);
                if (t.pid) {
                    try { process.kill(t.pid); } catch(e) {}
                    t.status = 'KILLED';
                    return `Task ${taskId} (PID ${t.pid}) has been terminated.`;
                }
                return `Task ${taskId} has no running process PID.`;
            }

            return `Unknown task action "${action}". Valid actions: list, status, logs, kill.`;
        }

        // 3. BINARY & APK INSPECTION (REA Integration)
        if (toolName === 'open_binary' || toolName === 'inspect_binary' || toolName === 'open_apk') {
            const targetPath = path.resolve(process.cwd(), args.path || args.file_path || args.target || '');
            if (!fsSync.existsSync(targetPath)) return `Error: Target binary not found at ${targetPath}`;

            const isApk = targetPath.endsWith('.apk') || args.provider_id === 'android';
            if (isApk) {
                const { stdout: fileInfo } = await execAsync(`file "${targetPath}" || true`);
                const { stdout: zipList } = await execAsync(`unzip -l "${targetPath}" | head -n 35`);
                const { stdout: dexCount } = await execAsync(`unzip -l "${targetPath}" | grep -c "\\.dex" || echo "0"`);
                return `=== Binary Opened (Android APK): ${targetPath} ===\n${fileInfo.trim()}\nTotal DEX files: ${dexCount.trim()}\n\nSample Contents:\n${zipList}\n\nHint: Use 'inspect_apk' or 'search_android_classes' or 'execute_command' (e.g. strings, unzip, aapt2) to drill into specific logic.`;
            } else {
                const { stdout: fileInfo } = await execAsync(`file "${targetPath}" || true`);
                const { stdout: sizeInfo } = await execAsync(`ls -lh "${targetPath}"`);
                return `=== Binary Opened: ${targetPath} ===\n${sizeInfo.trim()}\n${fileInfo.trim()}`;
            }
        }

        if (toolName === 'analyze_function' || toolName === 'search_android_classes' || toolName === 'inspect_android_class') {
            const apkPath = path.resolve(process.cwd(), args.apk_path || args.path || '');
            const query = args.query || args.class_name || args.method_name || 'update';
            if (!fsSync.existsSync(apkPath)) return `Error: APK file not found at ${apkPath}`;

            const { stdout } = await execAsync(`strings "${apkPath}" | grep -iE "${query}" | head -n 40 || true`);
            return `=== String and Class References for "${query}" in ${apkPath} ===\n${stdout || 'No direct references found.'}`;
        }

        // 4. READ FILE
        if (toolName === 'read_file') {
            const filePath = path.resolve(process.cwd(), args.path || args.file_path || '');
            if (!fsSync.existsSync(filePath)) return `Error: File not found: ${filePath}`;
            const raw = await fs.readFile(filePath, 'utf8');
            if (args.start_line !== undefined || args.end_line !== undefined) {
                const lines = raw.split('\n');
                const start = Math.max(1, args.start_line || 1);
                const end = Math.min(lines.length, args.end_line || lines.length);
                const selected = lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
                return `--- ${filePath} (lines ${start}-${end} of ${lines.length}) ---\n${selected}`;
            }
            if (raw.length > 50000) {
                return `--- ${filePath} (first 50KB) ---\n${raw.slice(0, 50000)}\n... [Truncated remaining ${raw.length - 50000} bytes]`;
            }
            return `--- ${filePath} ---\n${raw}`;
        }

        // 5. WRITE FILE
        if (toolName === 'write_file') {
            const filePath = path.resolve(process.cwd(), args.path || args.file_path || '');
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            if (args.append) {
                await fs.appendFile(filePath, args.content, 'utf8');
                return `Successfully appended to ${filePath}`;
            } else {
                await fs.writeFile(filePath, args.content, 'utf8');
                return `Successfully wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${filePath}`;
            }
        }

        // 6. PATCH FILE
        if (toolName === 'patch_file') {
            const filePath = path.resolve(process.cwd(), args.file_path || args.path || '');
            if (!fsSync.existsSync(filePath)) return `Error: File not found: ${filePath}`;
            let content = await fs.readFile(filePath, 'utf8');
            if (!content.includes(args.search_text)) {
                return `Error: exact search_text not found in ${filePath}. Check indentation and line breaks.`;
            }
            content = content.replace(args.search_text, args.replace_text);
            await fs.writeFile(filePath, content, 'utf8');
            return `Successfully patched ${filePath}`;
        }

        // 7. LIST DIRECTORY
        if (toolName === 'list_directory') {
            const dirPath = path.resolve(process.cwd(), args.path || '.');
            if (!fsSync.existsSync(dirPath)) return `Error: Directory not found: ${dirPath}`;
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const list = entries.map(e => {
                const type = e.isDirectory() ? '[DIR] ' : '[FILE]';
                return `${type} ${e.name}`;
            }).join('\n');
            return `--- Directory: ${dirPath} ---\n${list || '(empty directory)'}`;
        }

        // 8. WEB SEARCH
        if (toolName === 'web_search') {
            const query = encodeURIComponent(args.query);
            const res = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            const html = await res.text();
            const snippets = html.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/g) || [];
            const results = snippets.slice(0, 5).map(s => s.replace(/<[^>]*>/g, '').trim());
            if (results.length === 0) return `No clear results for query: "${args.query}"`;
            return `--- Web Search Results for "${args.query}" ---\n` + results.map((r, i) => `[${i + 1}] ${r}`).join('\n\n');
        }

        // 9. FETCH WEB CONTENT
        if (toolName === 'fetch_web_content') {
            const res = await fetch(args.url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const text = await res.text();
            const cleaned = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                                .replace(/<[^>]+>/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
            return `--- Content from ${args.url} ---\n${cleaned.slice(0, 8000)}`;
        }

        // 10. INSPECT APK
        if (toolName === 'inspect_apk') {
            const apk = path.resolve(process.cwd(), args.apk_path);
            if (!fsSync.existsSync(apk)) return `Error: APK file not found at ${apk}`;
            if (args.action === 'info') {
                const { stdout } = await execAsync(`unzip -l "${apk}" | head -n 30`);
                return `--- APK Info: ${apk} ---\n${stdout}`;
            }
            if (args.action === 'list_dex') {
                const { stdout } = await execAsync(`unzip -l "${apk}" | grep "\\.dex"`);
                return `--- DEX Files in ${apk} ---\n${stdout}`;
            }
            if (args.action === 'extract_manifest') {
                const tmpManifest = path.join(os.tmpdir(), `manifest_${Date.now()}.xml`);
                try {
                    await execAsync(`unzip -p "${apk}" AndroidManifest.xml > "${tmpManifest}"`);
                    return `AndroidManifest.xml extracted to ${tmpManifest} (${fsSync.statSync(tmpManifest).size} bytes binary XML).`;
                } catch(e) {
                    return `Extraction error: ${e.message}`;
                }
            }
            if (args.action === 'search_strings') {
                const q = args.query || 'update';
                const { stdout } = await execAsync(`strings "${apk}" | grep -i "${q}" | head -n 30 || true`);
                return `--- Strings matching "${q}" in ${apk} ---\n${stdout || 'No matching strings found.'}`;
            }
            return `Unsupported APK action: ${args.action}`;
        }

        // 11. IMPORT SKILL
        if (toolName === 'import_skill') {
            const candidatePaths = [
                path.join(process.cwd(), 'skills', `${args.skill_name}.md`),
                path.join(__dirname, 'skills', `${args.skill_name}.md`),
                path.join(os.homedir(), '.agents', 'skills', args.skill_name, 'SKILL.md'),
                path.join(os.homedir(), '.claude', 'skills', args.skill_name, 'SKILL.md')
            ];
            for (const p of candidatePaths) {
                if (fsSync.existsSync(p)) {
                    const skillContent = await fs.readFile(p, 'utf8');
                    return `--- Skill Injected: ${args.skill_name} ---\n${skillContent}`;
                }
            }
            return `Error: Skill "${args.skill_name}" not found in local skill directories.`;
        }

        // 12. UPDATE MEMORY
        if (toolName === 'update_memory') {
            const memoPath = path.join(process.cwd(), 'imp_memo.md');
            if (args.mode === 'append' && fsSync.existsSync(memoPath)) {
                await fs.appendFile(memoPath, '\n\n' + args.content, 'utf8');
            } else {
                await fs.writeFile(memoPath, args.content, 'utf8');
            }
            return `Core memory updated in ${args.mode} mode.`;
        }

        // 13. REASON
        if (toolName === 'reason') {
            return `Thought process recorded. Standing by for next action.`;
        }

        return `Error: Tool "${toolName}" is not recognized.`;
    } catch(err) {
        return `Execution Error in tool "${toolName}": ${err.message}`;
    }
}

module.exports = {
    schemas: capTools128(schemas),
    execute: executeTool,
    capTools128,
    backgroundTasks
};
