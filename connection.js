const { execSync } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastApiCallTime = 0;
const MIN_API_DELAY_MS = 4000;

function pruneHistory(history, maxTurns = 10) {
    if (history.length <= maxTurns) return history;
    return [...history.slice(0, 2), { role: "system", content: "[System: Older context pruned to conserve token bandwidth]" }, ...history.slice(-(maxTurns - 1))];
}

async function callAI({ activeModel, chatHistory, promptText, abortController, spinner, sysLog, colors, SYSTEM_PROMPT }) {
    if (activeModel.isLocal) {
        const safePrompt = JSON.stringify(promptText);
        const output = execSync(`python litert_engine.py --model "./gemma-local.tflite" --prompt ${safePrompt}`, { encoding: 'utf-8' });
        return JSON.parse(output.trim()).response;
    }

    const prunedHistory = pruneHistory(chatHistory);
    const baseUrl = activeModel.baseUrl || "https://generativelanguage.googleapis.com";
    const isGemini = baseUrl.includes('googleapis.com');
    
    let fetchUrl = "";
    let fetchOptions = { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abortController.signal };
    let fetchBody = {};

    if (isGemini) {
        fetchUrl = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${activeModel.modelId}:generateContent?key=${activeModel.apiKey}`;
        const messages = prunedHistory.map(msg => ({ role: msg.role === 'ai' || msg.role === 'system' ? 'model' : 'user', parts: [{ text: msg.content }] }));
        messages.push({ role: "user", parts: [{ text: promptText }] });
        fetchBody = {
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: messages,
            generationConfig: { responseMimeType: "application/json", temperature: activeModel.temperature || 0.7, maxOutputTokens: activeModel.maxTokens || 4096 }
        };
    } else {
        fetchUrl = baseUrl;
        fetchOptions.headers['Authorization'] = `Bearer ${activeModel.apiKey}`;
        fetchOptions.headers['HTTP-Referer'] = 'https://github.com/termux-agent';
        
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...prunedHistory.map(msg => ({ role: msg.role === 'ai' ? 'assistant' : msg.role, content: msg.content })),
            { role: "user", content: promptText }
        ];

        fetchBody = { model: activeModel.modelId, messages: messages, temperature: activeModel.temperature || 0.7, max_tokens: activeModel.maxTokens || 4096, stream: false };
    }

    fetchOptions.body = JSON.stringify(fetchBody);

    const maxRetries = 6;
    let retries = 0;

    while (retries < maxRetries) {
        if (abortController.signal.aborted) throw new Error("AbortError");
        const timeSinceLastCall = Date.now() - lastApiCallTime;
        if (timeSinceLastCall < MIN_API_DELAY_MS) {
            spinner.update("Queueing request");
            await sleep(MIN_API_DELAY_MS - timeSinceLastCall);
        }
        if (abortController.signal.aborted) throw new Error("AbortError");

        lastApiCallTime = Date.now();
        if (retries > 0) spinner.update(`Retrying (${retries}/${maxRetries})`);

        let rawText = "";
        let res;
        try {
            res = await fetch(fetchUrl, fetchOptions);
            rawText = await res.text(); 
        } catch(e) {
            if (e.name === 'AbortError') throw e;
            throw new Error(`Network failure: ${e.message}`);
        }
        
        let data;
        try { data = JSON.parse(rawText); } 
        catch(e) { throw new Error(`API returned an invalid payload: ${rawText.substring(0, 150)}...`); }
        
        if (!res.ok) {
            if (res.status === 429 || res.status === 402) {
                retries++;
                let providerError = "Rate Limit or Insufficient Quota";
                if (data.error && data.error.message) providerError = data.error.message;
                
                spinner.stop(true);
                sysLog(`${colors.yellow}⚠ API Rejection [Status ${res.status}]: ${providerError}${colors.reset}`);
                spinner.start();

                let waitTimeMs = (4000 * Math.pow(2, retries)) + Math.floor(Math.random() * 1000); 
                try {
                    const details = data.error?.details?.find(d => d['@type'].includes('RetryInfo'));
                    if (details && details.retryDelay) waitTimeMs = Math.max(waitTimeMs, parseInt(details.retryDelay.replace('s', '')) * 1000 + 1000); 
                } catch(e) {}
                
                spinner.update(`Cooldown for ${(waitTimeMs/1000).toFixed(1)}s`);
                await sleep(waitTimeMs);
                continue; 
            }
            throw new Error(JSON.stringify(data));
        }
        
        const aiText = isGemini ? data.candidates?.[0]?.content?.parts?.[0]?.text : data.choices?.[0]?.message?.content;
        if (!aiText) throw new Error("Model API returned empty or null content.");
        return aiText;
    }
    throw new Error("Maximum rate limit retries exceeded.");
}

module.exports = { callAI };
