document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const index = parseInt(params.get('index'), 10);

  chrome.storage.local.get('vault', data => {
    const vault = data.vault || [];
    const item = vault[index];

    if (!item) {
      document.getElementById('content').innerHTML = "<h1>Error: Note not found.</h1>";
      return;
    }

    const date = new Date(item.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    document.getElementById('content').innerHTML = `
      <div class="vault-detail-title">${item.title || 'Untitled'}</div>
      <div class="vault-detail-author">${item.authors || ''} · ${date}</div>

      <div class="card">
        <div class="card-label">CLIFF NOTES</div>
        <ul class="summary-list">
          ${(item.summary || []).map(s => `<li>${s}</li>`).join('')}
        </ul>
      </div>

      <div class="card">
        <div class="card-label">FLASHCARDS</div>
        ${(item.flashcards || []).map(f => `
          <div class="flash-card">
            <div class="flash-q">${f.q}</div>
            <div class="flash-a">${f.a}</div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="card-label">MY NOTES</div>
        <div class="notes-area">${item.notes || 'No custom notes added.'}</div>
      </div>
    `;

    // Wait briefly for styles to apply before opening print dialog
    setTimeout(() => {
      window.print();
    }, 300);
  });
});
