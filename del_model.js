const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function run() {
    console.log("┌──────────────────────────────────────────┐");
    console.log("│         MODEL DELETION UTILITY           │");
    console.log("└──────────────────────────────────────────┘\n");

    if (!fs.existsSync('models.json')) {
        console.log("⚠️ models.json not found. Nothing to delete.");
        process.exit(0);
    }

    let models;
    try {
        models = JSON.parse(fs.readFileSync('models.json', 'utf8'));
    } catch(e) {
        console.log("✖ Error reading models.json. File may be corrupted.");
        process.exit(1);
    }

    if (models.length === 0) {
        console.log("No models available to delete.");
        process.exit(0);
    }

    console.log("Available Cores:");
    models.forEach((m, i) => console.log(`  [${i+1}] ${m.name}`));

    const choice = await ask(`\nSelect a model to delete [1-${models.length}] or press Enter to cancel: `);
    
    const index = parseInt(choice) - 1;
    if (!isNaN(index) && index >= 0 && index < models.length) {
        const deleted = models.splice(index, 1)[0];
        fs.writeFileSync('models.json', JSON.stringify(models, null, 2));
        console.log(`✔ Successfully deleted: ${deleted.name}`);
    } else {
        console.log("⚠ Deletion cancelled or invalid selection.");
    }
    
    process.exit(0);
}

run();
