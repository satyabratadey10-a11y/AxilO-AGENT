# AxilO AGENT

AxilO AGENT is a Node.js + TypeScript AI agent runtime designed for terminal-first workflows and headless integrations. It provides a polished CLI experience, model profile management, session persistence, and a pluggable tool system so you can build and operate tool-using assistants locally or behind an API.

## Highlights

- **Interactive CLI** with guided prompts, slash commands, and local history persistence.
- **Headless REST API** for embedding the agent in other services.
- **Model profiles** stored locally (no hard-coded credentials).
- **Extensible tools** in `tools.js` with safe execution gates.
- **TypeScript core** in `src/` compiled to `dist/` for runtime stability.

## Requirements

- Node.js 18+
- npm
- Python 3 + pip (optional, for helper scripts such as `litert_engine.py`)
- ffmpeg/ffprobe (optional, for media tools exposed by `tools.js`)

## Installation

### Automated setup

```bash
git clone https://github.com/satyabratadey10-a11y/TUF-AGENT.git
cd TUF-AGENT
chmod +x AxilO
./AxilO
```

### Manual setup

```bash
npm install
npx tsc
python3 -m pip install -r requirements.txt
```

## Configure a model profile

Run the profile wizard to create `models.json`:

```bash
node add_model.js
```

You can remove profiles with:

```bash
node del_model.js
```

## Run the CLI

Start the interactive terminal agent:

```bash
node agent.js
```

This repository includes `agent.js` in the root as the CLI entry point. It loads your model profiles, prompts you to select a model, and stores chat history in `history.json`.

## Run the headless API server

Build the TypeScript sources (if you have not already):

```bash
npx tsc
```

Start the API server:

```bash
node server.js
```

`server.js` runs the headless runtime backed by the compiled TypeScript core in `dist/`. The server listens on **http://127.0.0.1:8080** (change the `PORT` constant in `server.js` to customize) and persists sessions in `sessions.json`. It exposes:

- `POST /api/chat` — send a prompt (and optional `sessionId`).
- `POST /api/approve` — approve or deny tool calls that require human consent.

## Customize tools

Edit `tools.js` to add or update tool schemas and execution logic. The API server reloads this file when a tool call executes, and will keep the last valid tool set if a syntax error is detected.

## Local data files

AxilO AGENT keeps runtime state in local JSON files that are intentionally gitignored:

- `models.json` — model profiles and API credentials
- `history.json` — CLI chat history
- `sessions.json` — API server session storage

## Optional demo UI

The `chat_app/` folder contains a minimal WebSocket demo UI and server for experimentation. It is standalone and not wired to the REST API server. To try it, run `node chat_app/server.js` and open `chat_app/index.html` in a browser. Note: the demo server also binds to port 8080. Stop the REST API server or change one of the ports to avoid conflicts. Update `server.js` for the REST API port or `chat_app/server.js` for the demo port.

## Project layout

| Path | Purpose |
| --- | --- |
| `agent.js` | Interactive CLI runtime |
| `server.js` | Headless REST API server |
| `add_model.js` / `del_model.js` | Model profile management |
| `tools.js` | Tool schema + execution registry |
| `src/` | TypeScript source for the core agent |
| `dist/` | Compiled runtime output |
| `chat_app/` | Standalone WebSocket demo UI |

## Security notes

- `models.json`, `history.json`, and `sessions.json` are intentionally gitignored.
- Store API keys only in local profile files and rotate them as needed.

## Troubleshooting

- **No profiles found:** run `node add_model.js` first.
- **Build output missing:** run `npx tsc` and confirm `dist/` exists.
- **Python tool errors:** install Python dependencies with `python3 -m pip install -r requirements.txt`.
