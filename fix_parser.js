const fs = require('fs');
const file = 'test.js';

if (!fs.existsSync(file)) {
    console.error("Error: test.js not found.");
    process.exit(1);
}

let code = fs.readFileSync(file, 'utf8');

const patch = `// --- RUNAWAY LLM PARSER PATCH ---
const _originalParse = JSON.parse;
JSON.parse = function(text, reviver) {
    if (typeof text === 'string' && text.includes('"action"')) {
        try { 
            return _originalParse(text, reviver); 
        } catch (e) {
            try {
                // If standard parse fails, hunt for the LAST valid action block
                const matches = text.match(/\\{\\s*"action"/g);
                if (matches) {
                    const lastStart = text.lastIndexOf(matches[matches.length - 1]);
                    const lastEnd = text.lastIndexOf('}');
                    if (lastStart !== -1 && lastEnd !== -1 && lastStart < lastEnd) {
                        return _originalParse(text.substring(lastStart, lastEnd + 1), reviver);
                    }
                }
            } catch(err) {}
            throw e;
        }
    }
    return _originalParse(text, reviver);
};
// --------------------------------\n`;

if (!code.includes('RUNAWAY LLM PARSER PATCH')) {
    fs.writeFileSync(file, patch + code);
    console.log("✅ Global JSON Parser patched in test.js.");
    console.log("✅ The AI will no longer crash or leak raw JSON when hallucinating tool outputs.");
} else {
    console.log("⚠️ Patch already applied.");
}
