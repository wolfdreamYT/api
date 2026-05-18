let userInput, userChat, aiChat;

function levenshtein(a, b) {
    const matrix = [];

    const alen = a.length;
    const blen = b.length;

    for (let i = 0; i <= blen; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= alen; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= blen; i++) {
        for (let j = 1; j <= alen; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[blen][alen];
}

function collectDatasetsFromScriptTags() {
    const found = {};
    const scripts = Array.from(document.querySelectorAll('script[data-dataset], script[id^="dataset-"]'));
    let usedResponsesFallback = false;

    scripts.forEach(script => {
        const dsName = script.getAttribute('data-dataset') || (script.id && script.id.startsWith('dataset-') ? script.id.slice('dataset-'.length) : null);
        if (!dsName) return;

        const dataGlobal = script.getAttribute('data-global');
        const candidates = [];
        if (dataGlobal) candidates.push(window[dataGlobal]);
        candidates.push(window[dsName]);
        candidates.push(window[dsName + 'Dataset']);
        candidates.push(window[dsName + 'Responses']);

        let foundObj = candidates.find(c => typeof c === 'object' && c !== null);

        if (!foundObj) {
            const txt = script.textContent && script.textContent.trim();
            const scriptType = (script.getAttribute('type') || '').toLowerCase();
            if (txt) {
                if (scriptType === 'application/json' || txt[0] === '{' || txt[0] === '[') {
                    try {
                        foundObj = JSON.parse(txt);
                    } catch (e) {
                    }
                }
            }
        }

        if (!foundObj && typeof responses !== 'undefined' && (dsName === 'main' || !usedResponsesFallback)) {
            foundObj = responses;
            usedResponsesFallback = true;
        }

        if (foundObj) {
            found[dsName] = foundObj;
        } else {
            console.warn(`Dataset "${dsName}" not found. Make sure the script defines a global (e.g. window.${dsName} = {...}) or include inline JSON: <script data-dataset="${dsName}" type="application/json">{ ... }</script>. You can also set data-global on the script tag to point to an existing global.`);
            found[dsName] = {};
        }
    });

    if (Object.keys(found).length === 0) {
        return {
            main: (typeof responses !== 'undefined' ? responses : {})
        };
    }

    return found;
}

const datasets = collectDatasetsFromScriptTags();

const stopwords = new Set([
    "the","is","at","which","on","and","a","an","in","of","to","for","with","that","this","it","as","by","are","was","be","or"
]);

function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t && !stopwords.has(t));
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMessageHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function appendMessage(who, text) {
    if (!aiChat) return;

    const isUser = /^user$/i.test(who) || /^you$/i.test(who);

    const msg = document.createElement('div');
    msg.className = 'message ' + (isUser ? 'user' : 'bot');

    const content = document.createElement('div');
    content.className = 'content';
    content.innerHTML = formatMessageHtml(text);

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = isUser ? 'You' : 'Model A';

    msg.appendChild(content);
    msg.appendChild(meta);

    aiChat.appendChild(msg);
    aiChat.scrollTop = aiChat.scrollHeight;
}

function getTopCandidates(input, topN = 5) {
    const userTokens = tokenize(input);
    const candidates = [];

    for (const datasetName in datasets) {
        const ds = datasets[datasetName] || {};
        for (const key in ds) {
            const keyText = key.toString().toLowerCase();
            const keyTokens = tokenize(keyText);

            const keySet = new Set(keyTokens);
            let matches = 0;
            for (const t of userTokens) if (keySet.has(t)) matches++;

            let substringMatch = 0;
            for (const t of userTokens) {
                if (keyText.includes(t)) substringMatch++;
            }
            const distance = levenshtein(input, keyText);

            candidates.push({
                datasetName,
                key,
                value: ds[key],
                matches,
                substringMatch,
                distance,
                keyTokensLength: keyTokens.length
            });
        }
    }

    candidates.sort((a, b) => {
        const aScore = a.matches + (a.substringMatch * 0.5);
        const bScore = b.matches + (b.substringMatch * 0.5);
        if (bScore !== aScore) return bScore - aScore;
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.keyTokensLength - b.keyTokensLength;
    });

    return candidates.slice(0, topN);
}

document.addEventListener('DOMContentLoaded', () => {
    userInput = document.getElementById('userInput');
    userChat = document.getElementById('userChat');
    aiChat = document.getElementById('ai-chat');

    if (userChat) userChat.textContent = 'Send';

    if (userChat) userChat.addEventListener('click', () => {
        const userMessage = userInput.value;
        appendMessage('User', userMessage);

        const msg = userMessage.trim();
        if (!msg) {
            appendMessage('AI', 'Please enter a message.');
            return;
        }

        const normalized = msg.toLowerCase();

        const topCandidates = getTopCandidates(normalized, 5);

        const bestByMatch = topCandidates.reduce((best, cur) => {
            if (!best) return cur;
            const bestScore = best.matches + best.substringMatch * 0.5;
            const curScore = cur.matches + cur.substringMatch * 0.5;
            if (curScore > bestScore) return cur;
            if (curScore === bestScore && cur.distance < best.distance) return cur;
            return best;
        }, null);

        let bestByDistance = null;
        if (topCandidates.length) {
            bestByDistance = topCandidates.reduce((a, b) => (a.distance <= b.distance ? a : b));
        }

        if (bestByMatch && (bestByMatch.matches > 0 || bestByMatch.substringMatch > 0)) {
            appendMessage('AI', bestByMatch.value);
            return;
        }

        if (bestByDistance && bestByDistance.distance <= Math.max(3, Math.floor(Math.max(normalized.length, bestByDistance.keyTokensLength) * 0.3))) {
            appendMessage('AI', bestByDistance.value);
            return;
        }

        if (typeof reply !== 'undefined' && reply) {
            appendMessage('AI', reply);
            return;
        }

        if (topCandidates.length > 0) {
            const suggestions = topCandidates.map(c => `${c.key} (${c.datasetName})`).join('; ');
            setTimeout(() => {
                appendMessage('AI', `No matches found. Did you mean: ${suggestions}?`);
            }, 500);
            return;
        }

        setTimeout(() => {
            appendMessage('AI', `Cannot find "${userMessage}" in the database.`);
        }, 500);
    });

    if (userInput) userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') userChat.click();
    });
});
