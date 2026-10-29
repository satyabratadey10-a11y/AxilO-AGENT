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
- **Dual-Mode Command Execution**:
  - **Synchronous**: Fast execution with real-time spinner, duration timer, and output snippets.
  - **Background Tasks**: Long-running builds, servers, or watchers spawned asynchronously (`is_background: true`) with Task IDs and log streaming to `~/.axilo/tasks/<id>.log`. Managed via `/tasks`.
- **Reverse Engineering & APK Analysis**: Native reverse engineering tools (`open_binary`, `inspect_apk`, `search_android_classes`, `analyze_function`) for inspecting Android APKs, DEX units, manifests, strings, dialogs, and update gates.
- **Dynamic Skill Routing**: Modular skill engine supporting domain-specific rules (`/rea`, `/frontend-design`, `/ui-ux-pro-max`, `/web-design-guidelines`) with single-turn scoping and `/noskill` clearing.
- **Real-Time Streaming & Thought Traces**: Streams both thought tokens (`delta.reasoning` / `delta.thinking`) and generated content with clean Claude Code style glyphs (`⎿ `).

---

## 📁 System Architecture

```
~/.axilo/
├── agent.js              # Core orchestrator loop, TUI, slash commands & tool calling
├── connection.js         # Multi-provider API gateway (AgentRouter, Anthropic, OpenAI, Colab)
├── tools.js              # Native tool registry (Bash, Tasks, APK Analysis, Filesystem)
├── models.json           # Model configurations, endpoints, and credentials
├── setup_qwen_colab.py   # GPU provisioning script for Google Colab (Ollama + T4 + Tunnel)
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

AxilO includes full automation to run large open-weights models (Qwen 3.5 9B / Qwen 3.8) accelerated by Google Colab's 16GB Tesla T4 GPU:

### 1. One-Click Keepalive Daemon
To ensure Google Colab never disconnects due to idle timeouts and the public Cloudflare tunnel stays online indefinitely, run the auto-healing daemon in the background:

```bash
python3 ~/.axilo/colab_daemon.py &
```

The daemon automatically:
1. Connects to or creates the `qwen-t4` session with Tesla T4 GPU using Colab CLI.
2. Installs Ollama with Flash Attention (`OLLAMA_FLASH_ATTENTION=1`) and 24h keep-alive.
3. Pulls `qwen3.5:9b`, creates aliases (`qwen3.5`, `qwen3.8`), and warms up VRAM.
4. Exposes the API via a public Cloudflare Tunnel.
5. Automatically updates `~/.axilo/models.json` with the active live endpoint.
6. Emits periodic kernel heartbeats every 30 seconds to prevent Google Colab from idling out or shutting down the VM.

### 2. Manual Setup (Alternative)
```bash
# Create session on Colab with T4 GPU
colab new --session qwen-t4 --gpu T4

# Execute automated GPU setup script
colab exec -s qwen-t4 -f ~/.axilo/setup_qwen_colab.py --timeout 600
```

Once running, switch to the model in AxilO:
```text
❯ /model qwen3.5:9b
✔ Switched model to: Qwen 3.5 9B (Google Colab T4 GPU)
```

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
