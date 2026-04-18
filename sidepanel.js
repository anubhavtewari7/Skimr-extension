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
    } else {
      hudPanel.classList.add('hidden');
      vaultPanel.classList.remove('hidden');
      renderVault();
    }
  });
});

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
  // Switch to HUD tab if needed
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'hud'));
  hudPanel.classList.remove('hidden');
  vaultPanel.classList.add('hidden');
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

    // Extract Text directly from the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab linked.');

    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.substring(0, 25000) // generous text limit
    });

    const pageText = injection[0]?.result;
    if (!pageText || pageText.trim().length < 50) {
      throw new Error("Could not detect enough readable text on this page.");
    }

    updateStatus('PROCESSING...', 'Skimr AI is extracting insights...');
    const results = await AiService.analyzeText(pageText);

    latestScan = { ...results, savedAt: new Date().toISOString(), notes: '', rawText: pageText };
    renderResults(results);
    saveVaultBtn.classList.remove('hidden');
    rescanBtn.classList.remove('hidden'); // Show NEW SCAN button

  } catch (err) {
    updateStatus('LINK FAILURE', err.message);
    saveVaultBtn.classList.add('hidden');
    setTimeout(() => {
      resultView.classList.add('hidden');
      scanView.classList.remove('hidden');
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
