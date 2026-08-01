import { AiService } from './ai_service.js';

// ═══════════════════════════════════════════
// ELEMENT REFS
// ═══════════════════════════════════════════
const igniteBtn     = document.getElementById('ignite-btn');
const pulseOrb      = document.getElementById('pulse-orb');
const scanView      = document.getElementById('scan-view');
const resultView    = document.getElementById('result-view');
const hudPanel      = document.getElementById('hud-panel');
const vaultPanel    = document.getElementById('vault-panel');
const settingsPanel = document.getElementById('settings-panel');
const settingsBtn   = document.getElementById('settings-toggle-btn');
const geminiKeyInput = document.getElementById('gemini-key-input');
const saveKeyBtn    = document.getElementById('save-key-btn');
const keyStatusMsg  = document.getElementById('key-status-msg');
const saveVaultBtn  = document.getElementById('save-vault-btn');
const rescanBtn     = document.getElementById('rescan-btn');
const vaultEmpty    = document.getElementById('vault-empty');
const vaultNotebook = document.getElementById('vault-notebook');
const vaultTabsCol  = document.getElementById('vault-tabs-col');
const vaultDetail   = document.getElementById('vault-detail');
const customFcInput = document.getElementById('custom-fc-input');
const customFcBtn   = document.getElementById('custom-fc-btn');

let latestScan = null;     // last scan result
let activeVaultIndex = 0;  // which vault entry is open

// Load saved key if present
chrome.storage.local.get('gemini_key', data => {
  if (data.gemini_key) {
    geminiKeyInput.value = data.gemini_key;
    keyStatusMsg.textContent = '✓ Custom Gemini Key Active';
  }
});

saveKeyBtn.addEventListener('click', () => {
  const val = geminiKeyInput.value.trim();
  chrome.storage.local.set({ gemini_key: val }, () => {
    keyStatusMsg.textContent = val ? '✓ Custom Key Saved' : 'Cleared. Using Zero-Key Default';
    setTimeout(() => { keyStatusMsg.textContent = val ? '✓ Custom Gemini Key Active' : ''; }, 2000);
  });
});

// ═══════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const view = btn.dataset.view;
    if (view === 'hud') {
      hudPanel.classList.remove('hidden');
      vaultPanel.classList.add('hidden');
      if (settingsPanel) settingsPanel.classList.add('hidden');
    } else if (view === 'vault') {
      hudPanel.classList.add('hidden');
      vaultPanel.classList.remove('hidden');
      if (settingsPanel) settingsPanel.classList.add('hidden');
      renderVault();
    }
  });
});

if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    settingsBtn.classList.add('active');
    hudPanel.classList.add('hidden');
    vaultPanel.classList.add('hidden');
    settingsPanel.classList.remove('hidden');
  });
}

// ═══════════════════════════════════════════
// PULSE / FOCUS MODE
// ═══════════════════════════════════════════
pulseOrb.addEventListener('click', () => document.body.classList.toggle('pulsing'));

// ═══════════════════════════════════════════
// NEW SCAN (RESET)
// ═══════════════════════════════════════════
rescanBtn.addEventListener('click', () => {
  latestScan = null;
  resultView.classList.add('hidden');
  scanView.classList.remove('hidden');
  saveVaultBtn.classList.add('hidden');
  rescanBtn.classList.add('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'hud'));
  hudPanel.classList.remove('hidden');
  vaultPanel.classList.add('hidden');
});

// ═══════════════════════════════════════════
// EXPLAIN SELECTED TEXT (CONTEXT MENU & STORAGE)
// ═══════════════════════════════════════════
async function handleExplainText(text) {
  if (!text) return;
  // Switch to HUD
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'hud'));
  hudPanel.classList.remove('hidden');
  vaultPanel.classList.add('hidden');
  
  scanView.classList.add('hidden');
  resultView.classList.remove('hidden');
  saveVaultBtn.classList.add('hidden');
  rescanBtn.classList.remove('hidden');
  
  updateStatus('EXPLAINING...', 'Skimr is analyzing the selection...');
  try {
    const results = await AiService.analyzeText(text + "\n\n(Note: The user highlighted this specific text for explanation.)");
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const defaultNotes = `\n\n--- Highlight Explanation ---\nRetrieved ${dateStr}`;
    
    latestScan = { ...results, savedAt: new Date().toISOString(), notes: defaultNotes, rawText: text, url: '' };
    renderResults(results);
    saveVaultBtn.classList.remove('hidden');
  } catch (err) {
    updateStatus('EXPLANATION FAILED', err.message);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'EXPLAIN_TEXT') {
    handleExplainText(msg.text);
  }
});

// Check on load if context menu stored a pending explanation
chrome.storage.local.get('pendingExplanation', data => {
  if (data.pendingExplanation) {
    const text = data.pendingExplanation;
    chrome.storage.local.remove('pendingExplanation');
    handleExplainText(text);
  }
});

// ═══════════════════════════════════════════
// CORE SCAN LOGIC
// ═══════════════════════════════════════════
igniteBtn.addEventListener('click', async () => {
  try {
    scanView.classList.add('hidden');
    resultView.classList.remove('hidden');
    saveVaultBtn.classList.add('hidden');
    updateStatus('INITIALIZING...', 'Preparing capture');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active browser tab found.');

    const tabUrl = tab.url || '';
    const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:', 'https://chromewebstore.google.com'];
    if (restrictedPrefixes.some(p => tabUrl.startsWith(p))) {
      throw new Error('Skimr cannot scan Chrome system pages or the Web Store. Please switch to a regular website or article tab.');
    }

    let pageText = '';

    if (tabUrl.includes('youtube.com/watch')) {
      updateStatus('PROCESSING...', 'Extracting live video transcript...');
      let injection;
      try {
        injection = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            try {
              let pr = null;
              const flexy = document.querySelector('ytd-watch-flexy');
              if (flexy && flexy.playerData) pr = flexy.playerData;
              else if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.raw_player_response) {
                pr = JSON.parse(window.ytplayer.config.args.raw_player_response);
              }
              else if (window.ytInitialPlayerResponse) pr = window.ytInitialPlayerResponse;
              
              if (!pr) return null;
              
              const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
              if (!tracks || tracks.length === 0) return null;
              
              const englishTrack = tracks.find(t => t.languageCode.includes('en'));
              return englishTrack ? englishTrack.baseUrl : tracks[0].baseUrl;
            } catch (e) { return null; }
          }
        });
      } catch (scriptErr) {
        throw new Error('Permission denied to read YouTube tab.');
      }
      
      const captionUrl = injection[0]?.result;
      if (!captionUrl) throw new Error("Could not extract YouTube transcript. Make sure closed captions (CC) are enabled for this video.");
      
      try {
        const xmlRes = await fetch(captionUrl);
        const xmlText = await xmlRes.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        const textNodes = Array.from(xmlDoc.getElementsByTagName('text'));
        
        pageText = textNodes.map(node => {
          const t = document.createElement("textarea");
          t.innerHTML = node.textContent;
          return t.value;
        }).join(' ').substring(0, 15000);
      } catch (err) {
        throw new Error("Failed to fetch caption data from YouTube.");
      }
      if (!pageText) throw new Error("Transcript was empty.");
    } else {
      let injection;
      try {
        injection = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body.innerText.substring(0, 15000)
        });
      } catch (scriptErr) {
        throw new Error("Unable to read content from this page. Check tab permissions.");
      }

      pageText = injection[0]?.result;
      if (!pageText || pageText.trim().length < 50) {
        throw new Error("Could not detect enough readable text on this page.");
      }
    }

    updateStatus('PROCESSING...', 'Skimr AI is extracting insights...');
    const results = await AiService.analyzeText(pageText);

    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const defaultNotes = `\n\n--- Citation ---\n${tab.title || 'Unknown Source'}. Retrieved ${dateStr}, from ${tabUrl}`;

    latestScan = { ...results, savedAt: new Date().toISOString(), notes: defaultNotes, rawText: pageText, url: tabUrl };
    renderResults(results);
    saveVaultBtn.classList.remove('hidden');
    rescanBtn.classList.remove('hidden');

  } catch (err) {
    updateStatus('LINK FAILURE', err.message);
    saveVaultBtn.classList.add('hidden');
    rescanBtn.classList.remove('hidden');
    setTimeout(() => {
      if (latestScan === null) {
        resultView.classList.add('hidden');
        scanView.classList.remove('hidden');
      }
    }, 6000);
  }
});


// ═══════════════════════════════════════════
// CUSTOM FLASHCARDS
// ═══════════════════════════════════════════
customFcBtn.addEventListener('click', async () => {
  const q = customFcInput.value.trim();
  if (!q || !latestScan || !latestScan.rawText) return;

  const originalText = customFcBtn.textContent;
  customFcBtn.textContent = 'Thinking...';
  customFcBtn.disabled = true;

  try {
    const answer = await AiService.answerCustomFlashcard(q, latestScan.rawText);
    
    // Add to state
    if (!latestScan.flashcards) latestScan.flashcards = [];
    latestScan.flashcards.push({ q, a: answer });
    
    // Create new DOM element
    const fcContainer = document.getElementById('res-flashcards');
    const newCard = document.createElement('div');
    newCard.className = 'flash-card';
    newCard.innerHTML = `<div class="flash-q">${q}</div><div class="flash-a hidden">${answer}</div>`;
    newCard.addEventListener('click', () => newCard.querySelector('.flash-a').classList.toggle('hidden'));
    
    fcContainer.appendChild(newCard);
    customFcInput.value = '';
  } catch (err) {
    alert(err.message);
  } finally {
    customFcBtn.textContent = originalText;
    customFcBtn.disabled = false;
  }
});

// ═══════════════════════════════════════════
// SAVE TO VAULT
// ═══════════════════════════════════════════
saveVaultBtn.addEventListener('click', () => {
  if (!latestScan) return;

  chrome.storage.local.get('vault', data => {
    const vault = data.vault || [];
    const alreadySaved = vault.some(s => s.title === latestScan.title);

    if (alreadySaved) {
      saveVaultBtn.textContent = '✓ Already Saved';
      setTimeout(() => saveVaultBtn.textContent = '⊕ SAVE TO VAULT', 2000);
      return;
    }

    vault.unshift({ ...latestScan, notes: '' });
    chrome.storage.local.set({ vault }, () => {
      saveVaultBtn.classList.add('saved');
      saveVaultBtn.textContent = '✓ SAVED TO VAULT';
      setTimeout(() => {
        saveVaultBtn.classList.remove('saved');
        saveVaultBtn.textContent = '⊕ SAVE TO VAULT';
      }, 2500);
    });
  });
});

// ═══════════════════════════════════════════
// MULTIPLE-CHOICE QUIZ & STRENGTHS/WEAKNESSES SCORECARD
// ═══════════════════════════════════════════
const quizOverlay       = document.getElementById('quiz-overlay');
const startQuizBtn     = document.getElementById('start-quiz-btn');
const endQuizBtn       = document.getElementById('end-quiz-btn');
const quizCardContainer = document.getElementById('quiz-card-container');

let mcqQuestions   = [];
let currentQuizIdx = 0;
let userScore      = 0;
let userStrengths  = [];
let userWeaknesses = [];

// Helper: Fisher-Yates Shuffle
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Generate 4-option MCQs from Flashcards & Summary
function generateMcqQuestions(flashcards, summaryPoints = []) {
  if (!flashcards || flashcards.length === 0) return [];

  const genericDistractors = [
    "It is a secondary variable not directly examined in the study.",
    "No statistical correlation was established by researchers.",
    "It represents an alternative control condition.",
    "The data remains inconclusive according to current findings."
  ];

  const poolAnswers = flashcards.map(f => f.a);

  return flashcards.map((fc) => {
    const correctAnswer = fc.a;
    
    // Pick 3 distractors from other flashcards or fallback pool
    let distractorPool = poolAnswers.filter(a => a !== correctAnswer);
    if (distractorPool.length < 3) {
      distractorPool = [...distractorPool, ...summaryPoints, ...genericDistractors].filter(a => a !== correctAnswer);
    }
    
    const shuffledDistractors = shuffleArray(distractorPool).slice(0, 3);
    const options = shuffleArray([correctAnswer, ...shuffledDistractors]);
    const correctIndex = options.indexOf(correctAnswer);

    return {
      question: fc.q,
      options: options,
      correctIndex: correctIndex,
      correctAnswer: correctAnswer
    };
  });
}

startQuizBtn.addEventListener('click', () => {
  if (!latestScan || !latestScan.flashcards || latestScan.flashcards.length === 0) return;
  
  mcqQuestions   = generateMcqQuestions(latestScan.flashcards, latestScan.summary || []);
  currentQuizIdx = 0;
  userScore      = 0;
  userStrengths  = [];
  userWeaknesses = [];
  
  quizOverlay.classList.remove('hidden');
  renderMcqQuestion();
});

endQuizBtn.addEventListener('click', () => {
  quizOverlay.classList.add('hidden');
});

function renderMcqQuestion() {
  if (currentQuizIdx >= mcqQuestions.length) {
    renderScorecard();
    return;
  }

  const item = mcqQuestions[currentQuizIdx];
  const letters = ['A', 'B', 'C', 'D'];

  quizCardContainer.innerHTML = `
    <div class="card" style="width: 100%; border-color: var(--glass-border); box-shadow: 0 0 24px rgba(167, 243, 208, 0.08); text-align: left;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div class="card-label" style="margin: 0; font-size: 0.75rem;">QUESTION ${currentQuizIdx + 1} OF ${mcqQuestions.length}</div>
        <div style="font-size: 0.75rem; font-weight: 700; color: var(--accent);">${userScore} Correct</div>
      </div>

      <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 18px; line-height: 1.45; color: var(--text-vivid);">
        ${item.question}
      </div>

      <div class="quiz-options-box">
        ${item.options.map((opt, i) => `
          <div class="quiz-option" data-idx="${i}">
            <div class="quiz-opt-letter">${letters[i]}</div>
            <div style="flex: 1;">${opt}</div>
          </div>
        `).join('')}
      </div>

      <div id="quiz-next-container" class="hidden" style="margin-top: 16px;">
        <button id="next-mcq-btn" class="scan-btn" style="width: 100%; font-size: 0.8rem; padding: 12px;">
          ${currentQuizIdx === mcqQuestions.length - 1 ? 'VIEW SCORECARD 🏆' : 'NEXT QUESTION →'}
        </button>
      </div>
    </div>
  `;

  // Attach option click handlers
  let answered = false;
  const optionEls = quizCardContainer.querySelectorAll('.quiz-option');

  optionEls.forEach(optEl => {
    optEl.addEventListener('click', () => {
      if (answered) return;
      answered = true;

      const selectedIdx = parseInt(optEl.dataset.idx);

      // Disable hover on options
      optionEls.forEach(el => el.classList.add('disabled'));

      if (selectedIdx === item.correctIndex) {
        optEl.classList.add('correct');
        userScore++;
        userStrengths.push({ q: item.question, a: item.correctAnswer });
      } else {
        optEl.classList.add('incorrect');
        // Highlight correct option
        optionEls[item.correctIndex].classList.add('correct');
        userWeaknesses.push({ q: item.question, a: item.correctAnswer, chosen: item.options[selectedIdx] });
      }

      // Show next button
      document.getElementById('quiz-next-container').classList.remove('hidden');
    });
  });

  const nextBtn = document.getElementById('next-mcq-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentQuizIdx++;
      renderMcqQuestion();
    });
  }
}

function renderScorecard() {
  const total = mcqQuestions.length;
  const percentage = Math.round((userScore / total) * 100);

  quizCardContainer.innerHTML = `
    <div class="scorecard-container">
      <div style="text-align: center; margin-bottom: 16px;">
        <div style="font-size: 2.8rem; margin-bottom: 4px;">🏆</div>
        <h2 class="title-vivid" style="font-size: 1.3rem;">Quiz Completed</h2>
        <div class="score-badge">${percentage}%</div>
        <div style="color: var(--text-dim); font-size: 0.85rem; font-weight: 600;">
          Score: <span style="color: var(--accent);">${userScore} / ${total} Correct</span>
        </div>
      </div>

      ${userStrengths.length > 0 ? `
        <div class="section-box">
          <div class="strength-title">💪 MASTERY STRENGTHS (${userStrengths.length})</div>
          ${userStrengths.map(s => `
            <div class="result-item">
              <div style="color: var(--success); font-weight: 600;">✓ ${s.q}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${userWeaknesses.length > 0 ? `
        <div class="section-box">
          <div class="weakness-title">⚠️ AREAS FOR REVIEW (${userWeaknesses.length})</div>
          ${userWeaknesses.map(w => `
            <div class="result-item">
              <div style="color: var(--danger); font-weight: 600;">✗ ${w.q}</div>
              <div style="color: var(--accent); margin-top: 4px; font-size: 0.75rem; line-height: 1.4;">
                <span style="color: var(--text-dim);">Correct Insight:</span> ${w.a}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div style="display: flex; gap: 10px; margin-top: 18px; margin-bottom: 10px;">
        <button id="retry-mcq-btn" class="scan-btn" style="flex: 1; font-size: 0.75rem; padding: 10px;">⟳ RETAKE QUIZ</button>
        <button id="close-scorecard-btn" class="scan-btn" style="flex: 1; font-size: 0.75rem; padding: 10px; background: var(--glass-mid); color: var(--text-vivid);">DONE</button>
      </div>
    </div>
  `;

  document.getElementById('retry-mcq-btn').addEventListener('click', () => {
    currentQuizIdx = 0;
    userScore      = 0;
    userStrengths  = [];
    userWeaknesses = [];
    renderMcqQuestion();
  });

  document.getElementById('close-scorecard-btn').addEventListener('click', () => {
    quizOverlay.classList.add('hidden');
  });
}

// ═══════════════════════════════════════════
// RENDER VAULT NOTEBOOK
// ═══════════════════════════════════════════
function renderVault() {
  chrome.storage.local.get('vault', data => {
    const vault = data.vault || [];

    if (vault.length === 0) {
      vaultEmpty.classList.remove('hidden');
      vaultNotebook.classList.add('hidden');
      return;
    }

    vaultEmpty.classList.add('hidden');
    vaultNotebook.classList.remove('hidden');

    // Build left tab column
    vaultTabsCol.innerHTML = vault.map((item, i) => `
      <div class="vault-tab ${i === activeVaultIndex ? 'active' : ''}" data-index="${i}">
        <div class="vault-tab-title">${item.title || 'Untitled'}</div>
        <div class="vault-tab-date">${formatDate(item.savedAt)}</div>
      </div>
    `).join('');

    document.querySelectorAll('.vault-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeVaultIndex = parseInt(tab.dataset.index);
        renderVault(); // re-render to update active state
      });
    });

    // Render detail for active item
    renderVaultDetail(vault[activeVaultIndex], activeVaultIndex, vault);
  });
}

function renderVaultDetail(item, index, vault) {
  vaultDetail.innerHTML = `
    <div class="vault-detail-title">${item.title || 'Untitled'}</div>
    <div class="vault-detail-author">${item.authors || ''} · ${formatDate(item.savedAt)}</div>

    <div class="card">
      <div class="card-label">CLIFF NOTES</div>
      <ul class="summary-list">
        ${(item.summary || []).map(s => `<li>${s}</li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <div class="card-label">FLASHCARDS <span class="hint">(tap to reveal)</span></div>
      ${(item.flashcards || []).map((f, fi) => `
        <div class="flash-card" data-fi="${fi}">
          <div class="flash-q">${f.q}</div>
          <div class="flash-a hidden">${f.a}</div>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <div class="card-label" style="margin-bottom: 8px;">✏ MY NOTES</div>
      <textarea class="notes-area" id="notes-ta" placeholder="Add your own notes, scribbles, thoughts...">${item.notes || ''}</textarea>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <button id="save-notes-btn" class="scan-btn" style="padding: 8px 18px; font-size: 0.75rem;">SAVE NOTES</button>
        <div>
          <button class="scan-btn" id="export-pdf-btn" style="padding: 8px 18px; font-size: 0.75rem; background: var(--glass-mid); color: var(--text-vivid); margin-right: 8px;">🖨 EXPORT</button>
          <button class="danger-btn" id="delete-entry-btn">DELETE</button>
        </div>
      </div>
    </div>
  `;

  // Flashcard toggles
  document.querySelectorAll('.flash-card').forEach(card => {
    card.addEventListener('click', () => card.querySelector('.flash-a').classList.toggle('hidden'));
  });

  // Save notes
  document.getElementById('save-notes-btn').addEventListener('click', () => {
    const notes = document.getElementById('notes-ta').value;
    vault[index].notes = notes;
    chrome.storage.local.set({ vault }, () => {
      const btn = document.getElementById('save-notes-btn');
      btn.textContent = '✓ SAVED';
      setTimeout(() => btn.textContent = 'SAVE NOTES', 1500);
    });
  });

  // Auto-save notes on change (debounced)
  let debounceTimer;
  document.getElementById('notes-ta').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      vault[index].notes = document.getElementById('notes-ta').value;
      chrome.storage.local.set({ vault });
    }, 1000);
  });

  // Export to PDF
  document.getElementById('export-pdf-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('print.html?index=' + index) });
  });

  // Delete entry
  document.getElementById('delete-entry-btn').addEventListener('click', () => {
    vault.splice(index, 1);
    activeVaultIndex = Math.max(0, index - 1);
    chrome.storage.local.set({ vault }, renderVault);
  });
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function updateStatus(title, sub) {
  document.getElementById('res-title').innerText = title;
  document.getElementById('res-authors').innerText = sub;
}

function renderResults(data) {
  document.getElementById('res-title').innerText = data.title || 'Untitled';
  document.getElementById('res-authors').innerText = data.authors || '';

  document.getElementById('res-summary').innerHTML =
    '<ul class="summary-list">' +
    (data.summary || []).map(s => `<li>${s}</li>`).join('') +
    '</ul>';

  document.getElementById('res-flashcards').innerHTML =
    (data.flashcards || []).map(f => `
      <div class="flash-card">
        <div class="flash-q">${f.q}</div>
        <div class="flash-a hidden">${f.a}</div>
      </div>
    `).join('');

  document.querySelectorAll('.flash-card').forEach(card =>
    card.addEventListener('click', () => card.querySelector('.flash-a').classList.toggle('hidden'))
  );
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
