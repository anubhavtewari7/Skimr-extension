// Open sidepanel on icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('SidePanel behavior error:', error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('Skimr Initialized - Keyless Edition');
  chrome.contextMenus.create({
    id: 'skimr-explain',
    title: 'Skimr: Explain this',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'skimr-explain' && info.selectionText) {
    const textToExplain = info.selectionText;
    
    // Store pending explanation in storage so sidepanel reads it immediately upon open
    chrome.storage.local.set({ pendingExplanation: textToExplain }, () => {
      if (tab && tab.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
          console.warn('Could not auto-open sidepanel from context menu:', err);
        });
      }
      // Also broadcast message in case sidepanel is already open
      chrome.runtime.sendMessage({ action: 'EXPLAIN_TEXT', text: textToExplain }).catch(() => {
        // Ignore "Could not establish connection" if sidepanel is not open yet
      });
    });
  }
});

