// Open sidepanel on icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

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
    // Open side panel if not open, then send message
    chrome.sidePanel.open({ windowId: tab.windowId }, () => {
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'EXPLAIN_TEXT', text: info.selectionText });
      }, 500); // give it a moment to open
    });
  }
});
