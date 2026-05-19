const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { exec, spawnSync } = require('node:child_process');
const util = require('node:util');

const execAsync = util.promisify(exec);

// --- VISION HELPERS ---
const MAX_WIDTH = 512;
const MAX_FRAME_BYTES = 120 * 1024;

function encodeFrameSafe(framePath) {
    let buf = fsSync.readFileSync(framePath);
    if (buf.length > MAX_FRAME_BYTES) {
        spawnSync('ffmpeg', ['-y', '-i', framePath, '-qscale:v', '12', framePath], { timeout: 10000 });
        buf = fsSync.readFileSync(framePath);
    }
    return buf.toString('base64');
}

module.exports = {
    schemas: [
        { name: 'read_file', description: 'Reads local file contents safely.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
        { name: 'list_directory', description: 'Lists all files in a path.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
        { name: 'fetch_web_content', description: 'Fetches raw text data from a URL.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
        { name: 'analyze_media', description: 'Extracts metadata from a media file using ffprobe.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
        { name: 'load_editing_template', description: 'Loads a JSON template file.', parameters: { type: 'object', properties: { template_name: { type: 'string' } }, required: ['template_name'] } },
        { name: 'scan_video_scenes', description: 'Detects hard camera cuts using FFmpeg.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
        { name: 'generate_motion_heatmap', description: 'Uses an OpenCV Python engine to calculate pixel differences.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
        {
            name: 'vision_analysis',
            description: 'Extracts keyframes from a video and sends them to a Vision LLM for creative analysis (framing, transitions, visual impact).',
            parameters: {
                type: 'object',
                properties: {
                    video_path: { type: 'string' },
                    analysis_prompt: { type: 'string' },
                    interval_seconds: { type: 'number', description: 'Seconds between frames (default 4)' }
                },
                required: ['video_path', 'analysis_prompt']
            }
        },
        {
            name: 'graphify_build',
            description: 'Parses a codebase using tree-sitter to build a structural Knowledge Graph. Run this ONCE per project folder before querying.',
            parameters: { type: 'object', properties: { target_dir: { type: 'string', description: 'Absolute path to the codebase folder' } }, required: ['target_dir'] }
        },
        {
            name: 'graphify_query',
            description: 'Queries the codebase graph to find functions, trace paths, or explain architecture WITHOUT reading full files.',
            parameters: {
                type: 'object',
                properties: {
                    target_dir: { type: 'string', description: 'The codebase directory where the graph exists' },
                    action: { type: 'string', enum: ['explain', 'query', 'path'], description: 'explain (a specific class/function), query (natural language search), or path (trace dependencies)' },
                    query_text: { type: 'string', description: 'The entity or question. If action is path, put "StartNode EndNode" separated by a space.' }
                },
                required: ['target_dir', 'action', 'query_text']
            }
        },
        {
            name: 'patch_file',
            description: 'Surgically modifies a file by finding a specific block of text/code and replacing it. Best used after pinpointing a method via graphify.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string' },
                    search_text: { type: 'string', description: 'The EXACT original code block or text to replace' },
                    replace_text: { type: 'string', description: 'The new code' }
                },
                required: ['file_path', 'search_text', 'replace_text']
            }
        },
        // --- NEW TOOLS ---
        {
            name: 'web_search',
            description: 'Searches the internet for up-to-date information, documentation, or tutorials.',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
        },
        {
            name: 'reason',
            description: 'A tool to explicitly write out logical steps, theories, or math before executing dangerous system commands.',
            parameters: { type: 'object', properties: { thought_process: { type: 'string' } }, required: ['thought_process'] }
        },
        {
            name: 'import_skill',
            description: 'Dynamically loads a .md instruction file from the ./skills/ directory to learn a new framework or editing style.',
            parameters: { type: 'object', properties: { skill_name: { type: 'string', description: 'Name of the skill file without the .md extension' } }, required: ['skill_name'] }
        }
    ],
    execute: async (toolName, args) => {
        try {
            if (toolName === 'read_file') return `--- CONTENT OF ${args.path} ---\n${await fs.readFile(args.path, 'utf-8')}`;
            if (toolName === 'list_directory') return `--- DIRECTORY ---\n${(await fs.readdir(args.path)).join('\n')}`;
            if (toolName === 'fetch_web_content') return (await (await fetch(args.url)).text()).substring(0, 10000); 
            if (toolName === 'analyze_media') return (await execAsync(`ffprobe -v quiet -print_format json -show_format -show_streams "${args.file_path}"`)).stdout;
            if (toolName === 'load_editing_template') return `--- TEMPLATE LOADED ---\n${await fs.readFile(path.join('./templates', `${args.template_name}.json`), 'utf-8')}`;
            if (toolName === 'scan_video_scenes') {
                const { stdout } = await execAsync(`ffprobe -v quiet -show_entries frame=pkt_pts_time -of csv=p=0 -f lavfi "movie=${args.file_path},select=gt(scene\\,0.1)"`);
                let timestamps = stdout.split('\n').filter(t => t.trim() !== '').map(t => parseFloat(t).toFixed(2));
                return timestamps.length === 0 ? "No hard cuts detected." : `Cuts at (seconds): ${timestamps.join(', ')}`;
            }
            if (toolName === 'generate_motion_heatmap') {
                const { stdout, stderr } = await execAsync(`python motion_scanner.py "${args.file_path}"`);
                if (stderr && !stdout) return `Python Error: ${stderr}`;
                const heatmapData = JSON.parse(await fs.readFile('motion_heatmap.json', 'utf-8'));
                return `--- MOTION ANALYSIS ---\nTotal Frames: ${heatmapData.total_frames}\nHigh-Action Timestamps: ${heatmapData.high_action_timestamps.join(', ')}`;
            }
            if (toolName === 'vision_analysis') {
                let apiKey = process.env.GEMINI_API_KEY;
                if (!apiKey) {
                    try {
                        const modelsData = JSON.parse(await fs.readFile('./models.json', 'utf-8'));
                        const geminiModel = modelsData.find(m => m.name.toLowerCase().includes('gemini') && m.apiKey);
                        if (geminiModel) apiKey = geminiModel.apiKey;
                    } catch (e) {}
                }
                if (!apiKey) return "Error: Gemini API key not found.";
                
                const { video_path, analysis_prompt, interval_seconds = 4 } = args;
                if (!fsSync.existsSync(video_path)) return `Error: Video not found: ${video_path}`;
                const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'va_'));
                try {
                    const durResult = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', video_path], { encoding: 'utf8' });
                    const duration = parseFloat(JSON.parse(durResult.stdout).format.duration);
                    const max_frames = 28;
                    const effectiveInterval = duration > 600 ? Math.ceil(duration / max_frames) : interval_seconds;
                    const vfFilter = `select='gt(scene\\,0.30)+not(mod(t\\,${effectiveInterval}))',scale=${MAX_WIDTH}:-2`;
                    
                    spawnSync('ffmpeg', ['-loglevel', 'error', '-i', video_path, '-vf', vfFilter, '-vsync', 'vfr', '-frame_pts', '1', '-qscale:v', '5', '-f', 'image2', path.join(tmpDir, '%d.jpg')]);
                    
                    const files = fsSync.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).map(f => ({
                        framePath: path.join(tmpDir, f),
                        timestampSec: parseInt(f.replace('.jpg', ''), 10) / 12800
                    })).sort((a, b) => a.timestampSec - b.timestampSec).slice(0, max_frames);

                    if (files.length === 0) return "Error: No frames extracted.";

                    let allObservations = [];
                    const parts = [{ text: `Analyze these frames. Duration: ${duration.toFixed(1)}s. PROMPT: ${analysis_prompt}\n\nStrictly JSON: { "observations": [{ "timestamp_sec": number, "description": string, "edit_suggestion": string }] }` }];
                    files.forEach(f => {
                        parts.push({ text: `[FRAME @ ${f.timestampSec.toFixed(2)}s]` });
                        parts.push({ inlineData: { mimeType: 'image/jpeg', data: encodeFrameSafe(f.framePath) } });
                    });

                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=${apiKey}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: parts }], generationConfig: { responseMimeType: "application/json" } })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(`API Error: ${JSON.stringify(data)}`);
                    try {
                        const rawText = data.candidates[0].content.parts[0].text;
                        allObservations = JSON.parse(rawText.replace(/```json|```/g, '').trim()).observations || [];
                    } catch (e) {}
                    files.forEach(f => fsSync.unlinkSync(f.framePath));
                    return `--- VISION CUT LIST ---\n${JSON.stringify(allObservations, null, 2)}`;
                } finally {
                    fsSync.rmSync(tmpDir, { recursive: true, force: true });
                }
            }
            if (toolName === 'graphify_build') {
                const { target_dir } = args;
                const result = spawnSync('graphify', ['.'], { cwd: target_dir, encoding: 'utf-8' });
                try {
                    const report = await fs.readFile(path.join(target_dir, 'graphify-out', 'GRAPH_REPORT.md'), 'utf-8');
                    return `--- GRAPH BUILT ---\n${report.substring(0, 3000)}`;
                } catch (e) {
                    return `Failed reading report. stdout: ${result.stdout}`;
                }
            }
            if (toolName === 'graphify_query') {
                const { target_dir, action, query_text } = args;
                let graphifyArgs = [action];
                if (action === 'path') graphifyArgs.push(...query_text.split(' '));
                else graphifyArgs.push(query_text);
                const result = spawnSync('graphify', graphifyArgs, { cwd: target_dir, encoding: 'utf-8' });
                return result.stdout || result.stderr || `No output.`;
            }
            if (toolName === 'patch_file') {
                const { file_path, search_text, replace_text } = args;
                let content = await fs.readFile(file_path, 'utf-8');
                if (!content.includes(search_text)) return `Error: Exact search_text not found.`;
                content = content.replace(search_text, replace_text);
                await fs.writeFile(file_path, content, 'utf-8');
                return `Success: ${file_path} modified.`;
            }
            if (toolName === 'web_search') {
                const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                const html = await response.text();
                const snippets = html.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/g) || [];
                const cleanSnippets = snippets.map(s => s.replace(/<[^>]*>?/gm, '').trim()).slice(0, 5);
                return cleanSnippets.length > 0 ? `--- WEB RESULTS ---\n${cleanSnippets.join('\n\n')}` : "No clear results found.";
            }
            if (toolName === 'reason') {
                return `Thought process recorded. System is standing by for your next batched action.`;
            }
            if (toolName === 'import_skill') {
                const skillPath = path.join('./skills', `${args.skill_name}.md`);
                if (!fsSync.existsSync(skillPath)) return `Error: Skill file ${args.skill_name}.md not found in ./skills/.`;
                return `--- SKILL INJECTED ---\n${await fs.readFile(skillPath, 'utf-8')}`;
            }
            return `Error: Tool logic not implemented.`;
        } catch (err) {
            return `Execution Error: ${err.message}`;
        }
    }
};
