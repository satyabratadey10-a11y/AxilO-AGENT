const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function run() {
    console.log("┌──────────────────────────────────────────┐");
    console.log("│         MODEL CONFIGURATION UTILITY      │");
    console.log("└──────────────────────────────────────────┘\n");

    let models = [];
    if (fs.existsSync('models.json')) {
        try { models = JSON.parse(fs.readFileSync('models.json', 'utf8')); } 
        catch(e) { console.log("⚠️ models.json is corrupted. Creating a new configuration array."); }
    }

    let name = "";
    while (!name.trim()) {
        name = await ask("Enter Model Name (e.g., OpenRouter Claude 3.5): ");
        if (!name.trim()) console.log("✖ Model Name cannot be empty.");
    }

    let modelId = "";
    while (!modelId.trim()) {
        modelId = await ask("Enter Model ID (e.g., anthropic/claude-3.5-sonnet): ");
        if (!modelId.trim()) console.log("✖ Model ID cannot be empty.");
    }

    let endpointUrl = await ask("Enter Endpoint URL (Press Enter for default Google Gemini URL): ");
    if (!endpointUrl.trim()) {
        endpointUrl = "https://generativelanguage.googleapis.com";
        console.log("  ↳ Defaulting to Google Gemini Endpoint.");
    }

    let apiKey = "";
    while (!apiKey.trim()) {
        apiKey = await ask("Enter API Key (Mandatory): ");
        if (!apiKey.trim()) console.log("✖ API Key cannot be skipped.");
    }

    // Advanced Settings Configuration
    let temp = await ask("Enter Temperature (e.g., 0.7) [Press Enter for 0.7]: ");
    let tokens = await ask("Enter Max Tokens (e.g., 4096) [Press Enter for 4096]: ");
    let streamMode = await ask("Enable Stream? (true/false) [Press Enter for false]: ");

    const newModel = {
        name: name.trim(),
        modelId: modelId.trim(),
        baseUrl: endpointUrl.trim(),
        apiKey: apiKey.trim(),
        temperature: temp.trim() ? parseFloat(temp) : 0.7,
        maxTokens: tokens.trim() ? parseInt(tokens) : 4096,
        stream: streamMode.trim().toLowerCase() === 'true'
    };

    models.push(newModel);
    fs.writeFileSync('models.json', JSON.stringify(models, null, 2));
    
    console.log(`\n✔ Successfully added [${newModel.name}]`);
    console.log(`  Model ID: ${newModel.modelId} | Temp: ${newModel.temperature} | Tokens: ${newModel.maxTokens} | Stream: ${newModel.stream}`);
    process.exit(0);
}

run();
