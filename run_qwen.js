#!/usr/bin/env node
/**
 * AxilO - Qwen 3.5 / 3.8 Colab T4 Runner (Node.js Launcher)
 * Automatically creates/connects to a Tesla T4 Google Colab session, runs Qwen,
 * maximizes context window (32K), exposes public tunnel, and updates models.json.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptDir = __dirname;
let pyScript = path.join(scriptDir, 'run_qwen.py');

if (!fs.existsSync(pyScript)) {
    pyScript = '/data/data/com.termux/files/home/run_qwen.py';
}

function launch(pythonBin) {
    const proc = spawn(pythonBin, [pyScript, ...process.argv.slice(2)], {
        stdio: 'inherit'
    });

    proc.on('error', (err) => {
        if (pythonBin === 'python3') {
            launch('python');
        } else {
            console.error(`Error launching Python runner: ${err.message}`);
            process.exit(1);
        }
    });

    proc.on('close', (code) => {
        process.exit(code || 0);
    });
}

launch('python3');
