# TUF-AGENT (ai-agent-shd)

TUF-AGENT is a Node.js + TypeScript multi-agent CLI runtime for Termux/Linux.  
It supports model profile management, session persistence, dynamic tool loading, and optional MCP tool integration.

## What this project does

1. Runs an interactive AI agent (`node test.js`).
2. Lets you register multiple model endpoints (`node add_model.js`).
3. Saves chat memory/session history locally (`sessions.json`).
4. Supports tool calls with human approval gates for sensitive actions.
5. Can load external MCP tools from `mcp.json`.

## Requirements

### Core runtime

- Node.js 18+
- npm
- TypeScript compiler (installed via project dev dependencies)

### Python runtime (requested)

- Python 3
- pip / pip3
- `requests` package

The repository includes `requirements.txt` for Python dependencies.

## Dependencies in this project

### Node dependencies (`package.json`)

| Package | Type | Purpose |
|---|---|---|
| `@modelcontextprotocol/sdk` | dependency | MCP client integration |
| `typescript` | devDependency | Compile `src/*.ts` to `dist/*.js` |
| `@types/node` | devDependency | Node type definitions for TypeScript |

### Python dependencies (`requirements.txt`)

| Package | Purpose |
|---|---|
| `requests` | HTTP client for Python-side extensions/scripts |

## Installation

```bash
git clone https://github.com/satyabratadey10-a11y/TUF-AGENT.git
cd TUF-AGENT
chmod +x setup.sh
./setup.sh
```

### What `setup.sh` does

1. Ensures Node.js + npm are available (installs if missing where possible).
2. Ensures Python 3 + pip are available (installs if missing where possible).
3. Installs Node dependencies (`npm install`).
4. Installs Python dependencies (`pip install -r requirements.txt`).
5. Compiles TypeScript to `dist/`.
6. Initializes/repairs `models.json` and `sessions.json` as JSON arrays.
7. If those JSON files are invalid, it backs them up to `*.bak.<timestamp>` before reset.

### Setup flags

- `TUF_SETUP_UPGRADE=1 ./setup.sh`  
  Enables full `pkg upgrade` on Termux before installing runtime packages.

## Manual setup (without `setup.sh`)

```bash
npm install
npx tsc
python3 -m pip install -r requirements.txt
```

## Usage

### 1. Add one or more model profiles

```bash
node add_model.js
```

You will be asked for:
- Display name
- API endpoint
- Internal model ID
- API key (optional)
- Optional generation settings

### 2. Start agent runtime

```bash
node test.js
```

Main flow in runtime:
1. Select model profile.
2. Start new or resume previous session.
3. Chat with the agent.
4. Type `exit` to quit.

## Optional MCP integration

Create `mcp.json` in project root:

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
}
```

When this file exists, `test.js` starts MCP client transport, loads external tools, and routes matching tool calls to MCP.

## File-by-file guide (what each file does)

### Top-level files

| File | Purpose | When to use/edit |
|---|---|---|
| `setup.sh` | Bootstrap script for runtime/toolchain setup | First install, environment repair |
| `README.md` | Project documentation | Usage/setup/reference updates |
| `package.json` | Node metadata + dependencies | Add/remove JS/TS packages |
| `package-lock.json` | Locked Node dependency tree | Auto-updated after npm install/update |
| `requirements.txt` | Python dependency list | Add/remove Python packages |
| `tsconfig.json` | TypeScript compiler config | Build target/module/output settings |
| `add_model.js` | CLI to create/update model profiles | Configure model endpoints |
| `test.js` | Main interactive host app | Run the agent locally |
| `tools.js` | Dynamic native tools exposed to the agent | Add custom tools/capabilities |
| `models.json` | Local model profiles (private) | Stored credentials/config |
| `sessions.json` | Local chat/session memory (private) | Resume chat history |
| `mcp.json` (optional) | External MCP server config | Enable external MCP tools |

### Source files (`src/`)

| File | Purpose |
|---|---|
| `src/AIAgentSHD.ts` | Agent loop, memory handling, tool-call orchestration |
| `src/HttpProvider.ts` | HTTP completion provider + JSON decision parsing/retry handling |
| `src/ProfileManager.ts` | Read/write model profile store (`models.json`) |
| `src/SessionManager.ts` | Read/write session store (`sessions.json`) |
| `src/MCPManager.ts` | MCP client transport, list/execute external tools |

### Build output (`dist/`)

Compiled JavaScript (`*.js`) and declaration files (`*.d.ts`) generated from `src/`.  
Runtime entry files (`test.js`, `add_model.js`) import from here.

## Development workflow

1. Edit source in `src/` and/or `tools.js`.
2. Rebuild TypeScript:
   ```bash
   npx tsc
   ```
3. Run:
   ```bash
   node test.js
   ```

## Security and privacy notes

- `models.json` and `sessions.json` can contain sensitive data and are intentionally ignored by Git.
- High-risk actions in runtime (command execution, file write/delete, delegation) require explicit user approval.

## Troubleshooting

- **No model profiles found:** run `node add_model.js` first.
- **Build output missing:** run `npx tsc` and ensure `dist/AIAgentSHD.js` exists.
- **MCP not loading:** check `mcp.json` command/args and ensure the MCP server package is installed.
- **Python dependency issue:** run `python3 -m pip install -r requirements.txt`.
