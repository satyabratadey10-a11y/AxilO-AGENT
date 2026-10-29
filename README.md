# AxilO Code v2.5.0

An elite, autonomous terminal-first AI agent and reverse-engineering orchestrator engineered for Linux and Android Termux (`aarch64`). AxilO matches Claude Code visual aesthetics with a real-time animated TUI, continuous streaming reasoning, dual-mode command execution, multi-model shared session memory, and native Google Colab GPU acceleration.

```
           AxilO Code v2.5.0
 ▐▛███▜▌   gpt-5.6-sol · agentrouter.org
 ▝▜█████▛▘  /data/data/com.termux/files/home
   ▘▘ ▝▝    Welcome to AxilO! · /help for commands · /model to switch
```

---

## 🌟 Key Highlights

- **Dedicated Session Directories & Shared Memory**: Every session gets an isolated directory in `~/.axilo/sessions/session_<timestamp>_<id>/` with `memory.json` (conversational history) and `session.json` (metadata). Switching models mid-session via `/model <id>` retains complete shared context seamlessly.
- **Google Colab Tesla T4 GPU Acceleration**: Run local state-of-the-art models (Qwen 3.5 9B / Qwen 3.8) for free on 16GB Tesla T4 GPUs with Flash Attention (`OLLAMA_FLASH_ATTENTION=1`), 24h keep-alive, and self-healing Cloudflare Tunnels maintained by `colab_daemon.py`.
- **Maximized Context Window (32,768 Tokens)**: Eliminates the default 2,048 token limit that previously caused mid-sentence generation cutoffs. Fully backed by a 32K KV cache and Flash Attention on Tesla T4 VRAM, enabling uninterrupted multi-turn code analysis and large APK decompilations.
- **1-Command Auto-Boot Runners**: Start and configure the Colab GPU environment in one command using any runtime: `python run_qwen.py`, `bash run_qwen.sh`, or `node run_qwen.js`.
- **Dual-Mode Command Execution**:
  - **Synchronous**: Fast execution with real-time spinner, duration timer, and output snippets.
  - **Background Tasks**: Long-running builds, servers, or watchers spawned asynchronously (`is_background: true`) with Task IDs and log streaming to `~/.axilo/tasks/<id>.log`. Managed via `/tasks`.
- **Reverse Engineering & APK Analysis**: Native reverse engineering tools (`open_binary`, `inspect_apk`, `search_android_classes`, `analyze_function`) for inspecting Android APKs, DEX units, manifests, strings, dialogs, and update gates.
- **Dynamic Skill Routing**: Modular skill engine supporting domain-specific rules (`/rea`, `/frontend-design`, `/ui-ux-pro-max`, `/web-design-guidelines`) with single-turn scoping and `/noskill` clearing.
- **Real-Time Streaming & Thought Traces**: Streams both thought tokens (`delta.reasoning` / `delta.thinking`) and generated content with clean Claude Code style glyphs (`⎿ `).

---

## 📁 System Architecture

```
~/.axilo/ (and ~/ for launchers)
├── run_qwen.py           # Unified auto-boot runner (Colab T4 session, Ollama, tunnel, models.json)
├── run_qwen.sh           # Bash one-click wrapper for run_qwen.py
├── run_qwen.js           # Node.js wrapper for run_qwen.py
├── agent.js              # Core orchestrator loop, TUI, slash commands & tool calling
├── connection.js         # Multi-provider API gateway (AgentRouter, Anthropic, OpenAI, Colab)
├── tools.js              # Native tool registry (Bash, Tasks, APK Analysis, Filesystem)
├── models.json           # Model configurations, endpoints, context limits & credentials
├── setup_qwen_colab.py   # GPU provisioning script for Google Colab (Ollama + T4 + 32K Context + Tunnel)
├── colab_daemon.py       # Keepalive & auto-healing daemon preventing Colab idle pruning
├── skills/               # Installed skill guides & reverse engineering methodology
│   ├── rea.md            # Reverse Engineer Anything guidelines
│   ├── frontend-design/  # Production UI/UX system specs
│   └── ui-ux-pro-max/    # Multi-stack design intelligence
├── sessions/             # Dedicated session directories
│   └── session_<date>_<id>/
│       ├── memory.json   # Full conversation history preserved across model switches
│       └── session.json  # Session metadata, timing, and active models
└── tasks/                # Background process log files (<task_id>.log)
```

---

## ⚡ Global Installation & CLI Usage

Launch AxilO from any working directory on your system:

```bash
# Launch interactive agent loop in the current workspace
axilo

# Launch interactive model addition wizard
axilo --add-model

# Remove a configured model
axilo --delete-model

# Wipe legacy or cached session files
axilo --clear-sessions
```

---

## 🎮 Interactive Slash Commands

Inside the running AxilO CLI, use slash commands to manage models, sessions, tasks, and skills:

| Command | Description |
| :--- | :--- |
| `/model [id]` | Switch active model instantly (retains full conversation memory in current session). |
| `/models` | List all configured models with active indicator and endpoints. |
| `/session` | View current session directory, memory size, and message counts. |
| `/session list` | List all existing session directories. |
| `/session switch <id>` | Switch to an existing session directory. |
| `/session new [name]` | Create and switch to a fresh dedicated session directory. |
| `/tasks` | List running background commands and process IDs. |
| `/tasks logs <id>` | View recent logs for a specific background task. |
| `/tasks kill <id>` | Terminate a running background task. |
| `/skills` | List all installed domain skills. |
| `/<skill> <prompt>` | Execute a prompt with active skill guidelines loaded into context. |
| `/rea <apk_path> <prompt>` | Launch Reverse Engineering workflow directly against a target APK or binary. |
| `/noskill` | Clear active skill guidelines and restore standard terminal assistant mode. |
| `/tools` | List all registered native tools with their schemas. |
| `/compact` | Compact conversational history using autonomous summarization to save tokens. |
| `/clear` | Clear the current conversation history and terminal screen. |
| `/status` | View system resource usage, memory footprint, and Node runtime statistics. |
| `/help` | Display the interactive command guide. |
| `/exit` or `/quit` | Exit AxilO. |

---

## 🤖 Running Qwen 3.5 on Google Colab GPU

AxilO includes 1-command automation to run large open-weights models (**Qwen 3.5 9B / Qwen 3.8**) accelerated by Google Colab's 16GB Tesla T4 GPU with **32,768 context tokens**.

### 1. One-Click Launchers (Python / Bash / Node.js)

Run any of the following commands from your home directory or `~/.axilo`:

```bash
# Via Python
python run_qwen.py

# Via Bash
bash run_qwen.sh

# Via Node.js
node run_qwen.js
```

### What Happens Automatically:
1. **GPU Provisioning**: Checks Google Colab for an active `qwen-t4` session; if not found, provisions a fresh session with a **Tesla T4 GPU** (`colab new --session qwen-t4 --gpu T4`).
2. **Context Window Maximization (32K Tokens)**: Configures Ollama with a custom Modelfile setting `PARAMETER num_ctx 32768`, enabling 32,768 tokens of active context memory with Flash Attention.
3. **Cloudflare Tunnel Deployment**: Starts a public Cloudflare tunnel (`https://*.trycloudflare.com/v1`) exposing Ollama's OpenAI-compatible API.
4. **Auto-Configures `models.json`**: Automatically updates all Colab Qwen model entries with the live tunnel URL, `contextTokens: 32768`, `maxTokens: 8192`, and `options: { num_ctx: 32768 }`.
5. **Background Auto-Healing Daemon**: Spawns `colab_daemon.py` in the background with a 30-second kernel heartbeat to guarantee Google Colab never disconnects due to inactivity.

### 2. Switching to the Model in AxilO

Once the runner completes, switch to Qwen in your AxilO terminal:

```text
❯ /model qwen3.5:9b
✔ Switched model to: Qwen 3.5 9B (Google Colab T4 GPU) (qwen3.5:9b)
  Session memory preserved & shared across models in:
  /data/data/com.termux/files/home/.axilo/sessions/session_.../memory.json
```

### 3. Context Limit & Hardware Specifications

| Parameter | Configuration | Description |
| :--- | :--- | :--- |
| **GPU Hardware** | Tesla T4 (16GB GDDR6 VRAM) | Dedicated Google Colab cloud accelerator |
| **Model** | `qwen3.5:9b` (Aliases: `qwen3.8`, `qwen-3.5-9b`) | High-reasoning agent model |
| **Context Limit** | **32,768 Tokens** (`num_ctx 32768`) | 16× larger than default Ollama (2048) |
| **Max Output** | **8,192 Tokens** (`max_tokens 8192`) | Long-form code generations & diffs |
| **Attention Kernel** | `OLLAMA_FLASH_ATTENTION=1` | Zero OOM risk, optimal KV cache usage |
| **Keepalive** | 30s Heartbeat (`colab_daemon.py`) | Continuous kernel wakeups prevent idle timeout |

---

## 🛠️ Native Tools Reference

AxilO equips the model with direct system capabilities:

- **`execute_command`**: Execute bash shell commands directly in Termux/Linux. Supports both synchronous commands and background tasks (`is_background: true`).
- **`manage_task`**: Inspect, list, read logs, or kill active background tasks.
- **`open_binary`**: Inspect binaries and APKs; extracts package structure, DEX files, and strings.
- **`inspect_apk`**: Extract `AndroidManifest.xml`, list DEX units, or search strings.
- **`search_android_classes`**: Locate class names, dialogs, and activity components.
- **`analyze_function`**: Search and analyze methods, functions, and symbols.
- **`read_file`**, **`write_file`**, **`patch_file`**, **`list_directory`**: File manipulation with surgical diff patching.
- **`web_search`**, **`fetch_web_content`**: Web lookup and documentation extraction.
- **`update_memory`**: Append or update rules in persistent user memory (`imp_memo.md`).

---

## 📄 License

MIT License. Designed and maintained for high-performance terminal workflows.
