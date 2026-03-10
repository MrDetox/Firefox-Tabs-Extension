const MERGE_IN_PROGRESS = new Set();
const RETRY_COUNTS = new Map();
const MERGE_TIMERS = new Map();
const DEFAULT_SETTINGS = {
  enabled: true,
  debounceTime: 1200,
  rules: [],
  deduplicationRules: [],
  preventDuplicateTabs: false,
  closeOldTab: false,
  preferGroupedTabWhenDuplicate: false,
  skipDedupeWhenUserDuplicatedTab: true
};
const MAX_RETRIES = 5;

let settings = { ...DEFAULT_SETTINGS };
let rules = [];
let deduplicationRules = [];

function log(...args) {
  console.debug("[BetterTabGroups]", ...args);
}

async function loadSettings() {
  try {
    const result = await browser.storage.sync.get(DEFAULT_SETTINGS);
    settings.enabled = result.enabled !== false;
    settings.debounceTime = result.debounceTime || DEFAULT_SETTINGS.debounceTime;
    settings.preventDuplicateTabs = result.preventDuplicateTabs === true;
    settings.closeOldTab = result.closeOldTab === true;
    settings.preferGroupedTabWhenDuplicate = result.preferGroupedTabWhenDuplicate === true;
    settings.skipDedupeWhenUserDuplicatedTab = result.skipDedupeWhenUserDuplicatedTab !== false;
    rules = result.rules || [];
    deduplicationRules = result.deduplicationRules || [];
    log("Settings loaded:", settings, "Rules:", rules.length, "Deduplication rules:", deduplicationRules.length);
  } catch (error) {
    console.error("[BetterTabGroups] Failed to load settings:", error);
    settings = { ...DEFAULT_SETTINGS };
    rules = [];
    deduplicationRules = [];
  }
}

async function saveRules() {
  try {
    await browser.storage.sync.set({ rules });
    log("Rules saved:", rules.length);
  } catch (error) {
    console.error("[BetterTabGroups] Failed to save rules:", error);
  }
}

async function saveDeduplicationRules() {
  try {
    await browser.storage.sync.set({ deduplicationRules });
    log("Deduplication rules saved:", deduplicationRules.length);
  } catch (error) {
    console.error("[BetterTabGroups] Failed to save deduplication rules:", error);
  }
}

function matchesRule(url, rule) {
  if (!url || !rule.pattern) return false;
  const domain = getDomain(url);
  if (!domain) return false;
  
  const patternLower = rule.pattern.toLowerCase();
  const domainLower = domain.toLowerCase();
  
  // Exact match or contains match
  return domainLower === patternLower || 
         domainLower.includes(patternLower) || 
         patternLower.includes(domainLower);
}

async function findOrCreateGroupByName(groupName, windowId) {
  const allGroups = await browser.tabGroups.query({});
  const nameLower = groupName.toLowerCase();
  
  for (const group of allGroups) {
    if (group.title && group.title.toLowerCase() === nameLower && group.windowId === windowId) {
      return group.id;
    }
  }
  
  // No existing group found, will create when we group the tab
  return null;
}

async function applyRulesToTab(tab) {
  if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) {
    return;
  }
  
  if (tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
    return; // Already in a group
  }
  
  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    if (matchesRule(tab.url, rule)) {
      log(`Rule matched: "${rule.pattern}" → "${rule.groupName}" for tab ${tab.id}`);
      
      const existingGroupId = await findOrCreateGroupByName(rule.groupName, tab.windowId);
      
      if (existingGroupId) {
        await browser.tabs.group({ groupId: existingGroupId, tabIds: [tab.id] });
        log(`Added tab ${tab.id} to existing group "${rule.groupName}"`);
      } else {
        const newGroupId = await browser.tabs.group({ tabIds: [tab.id] });
        await browser.tabGroups.update(newGroupId, { title: rule.groupName });
        log(`Created new group "${rule.groupName}" for tab ${tab.id}`);
      }
      return; // Only apply first matching rule
    }
  }
}

async function getGroupSafe(groupId) {
  try {
    return await browser.tabGroups.get(groupId);
  } catch (error) {
    if (error && error.message && error.message.includes("No tab group")) {
      log("Group", groupId, "no longer exists; skipping merge.");
      return null;
    }
    console.error("[BetterTabGroups] Failed to fetch tab group", groupId, error);
    return null;
  }
}

async function findExistingGroupWithTabs(title, windowId, ignoreGroupId) {
  const candidates = await browser.tabGroups.query({ title });

  for (const candidate of candidates) {
    if (candidate.id === ignoreGroupId) {
      continue;
    }
    if (typeof windowId === "number" && candidate.windowId !== windowId) {
      continue;
    }

    const tabsInCandidate = await browser.tabs.query({ groupId: candidate.id });
    if (tabsInCandidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

async function mergeIfDuplicate(groupId) {
  if (MERGE_IN_PROGRESS.has(groupId)) {
    return;
  }

  MERGE_IN_PROGRESS.add(groupId);
  MERGE_TIMERS.delete(groupId);

  try {
    const group = await getGroupSafe(groupId);
    if (!group || !group.title) {
      RETRY_COUNTS.delete(groupId);
      return;
    }

    const existingGroup = await findExistingGroupWithTabs(
      group.title,
      group.windowId,
      group.id
    );

    if (!existingGroup) {
      log("No existing group with tabs found for title:", group.title);
      RETRY_COUNTS.delete(groupId);
      return;
    }

    const tabsInNewGroup = await browser.tabs.query({ groupId: group.id });
    if (tabsInNewGroup.length === 0) {
      const attempt = RETRY_COUNTS.get(group.id) ?? 0;
      if (attempt < MAX_RETRIES) {
        RETRY_COUNTS.set(group.id, attempt + 1);
        const delay = 100 * (attempt + 1);
        log(
          `Group ${group.id} is empty on attempt ${attempt + 1}; retrying merge in ${delay}ms.`
        );
        setTimeout(() => mergeIfDuplicate(group.id), delay);
      } else {
        log(
          `Group ${group.id} remained empty after ${MAX_RETRIES} attempts; skipping merge.`
        );
        RETRY_COUNTS.delete(group.id);
      }

      return;
    }

    RETRY_COUNTS.delete(groupId);

    const tabIds = tabsInNewGroup.map((tab) => tab.id);
    log(
      `Merging ${tabIds.length} tab(s) from group ${group.id} into existing group ${existingGroup.id} (${group.title}).`
    );

    await browser.tabs.group({
      groupId: existingGroup.id,
      tabIds,
    });
  } catch (error) {
    console.error("[BetterTabGroups] Failed to merge duplicate group", error);
  } finally {
    MERGE_IN_PROGRESS.delete(groupId);
  }
}

function scheduleMerge(groupId, reason) {
  if (!settings.enabled) {
    log("Extension is disabled; skipping merge for group", groupId);
    return;
  }

  if (MERGE_TIMERS.has(groupId)) {
    clearTimeout(MERGE_TIMERS.get(groupId));
  }

  const timerId = setTimeout(() => {
    MERGE_TIMERS.delete(groupId);
    mergeIfDuplicate(groupId);
  }, settings.debounceTime);

  MERGE_TIMERS.set(groupId, timerId);
  log(`Scheduled merge for group ${groupId} (${reason}) in ${settings.debounceTime}ms.`);
}

browser.tabGroups.onCreated.addListener((group) => {
  scheduleMerge(group.id, "created");
});

browser.tabGroups.onUpdated.addListener((group) => {
  scheduleMerge(group.id, "updated");
});

function getDomain(url) {
  try {
    const urlObj = new URL(url);
    // While a library would be best, keeping it simple as before but cleaner
    return urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash and normalize
    let path = urlObj.pathname;
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return urlObj.origin + path + urlObj.search + urlObj.hash;
  } catch (e) {
    return url;
  }
}

function normalizeUrlForPathMatch(url) {
  try {
    const urlObj = new URL(url);
    let path = urlObj.pathname;
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    // Ensure root path is consistently '/'
    if (path === '') {
      path = '/';
    }
    return urlObj.origin + path;
  } catch (e) {
    return url;
  }
}

function matchesDeduplicationRule(url, rule) {
  if (!url || !rule.url || !rule.enabled) return false;
  
  try {
    const ruleUrl = normalizeUrl(rule.url);
    const currentUrl = normalizeUrl(url);
    
    if (rule.matchType === 'exact') {
      // Exact URL match
      return ruleUrl === currentUrl;
    } else if (rule.matchType === 'domain') {
      // Domain-based match - any URL from the same domain
      const ruleDomain = getDomain(ruleUrl);
      const currentDomain = getDomain(currentUrl);
      return ruleDomain && currentDomain && ruleDomain.toLowerCase() === currentDomain.toLowerCase();
    } else if (rule.matchType === 'path') {
      // "Exact per page on domain" - rule applies to entire domain, but each URL only matches itself
      // This just checks if the URL is on the same domain as the rule
      // The actual duplicate check will look for exact URL matches only
      const ruleDomain = getDomain(ruleUrl);
      const currentDomain = getDomain(currentUrl);
      return ruleDomain && currentDomain && ruleDomain.toLowerCase() === currentDomain.toLowerCase();
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

async function checkForDuplicateTab(newTab) {
  if (!newTab.url || newTab.url.startsWith('about:') || newTab.url.startsWith('moz-extension:')) {
    return;
  }

  const normalizedNewTabUrl = normalizeUrl(newTab.url);

  // If this tab was created via "Duplicate Tab" (or opened from another tab with same URL),
  // the browser sets openerTabId to the source tab. Skip our deduplication so we don't undo the user's action.
  if (settings.skipDedupeWhenUserDuplicatedTab && newTab.openerTabId != null) {
    try {
      const openerTab = await browser.tabs.get(newTab.openerTabId);
      if (openerTab && openerTab.url && normalizeUrl(openerTab.url) === normalizedNewTabUrl) {
        log("Tab", newTab.id, "appears to be a duplicate of", newTab.openerTabId, "(same URL as opener); skipping deduplication.");
        return;
      }
    } catch (_) {
      // Opener tab no longer exists, proceed with normal deduplication
    }
  }

  // Global setting: prevent any duplicate tabs with exact same URL
  if (settings.preventDuplicateTabs) {
    try {
      const parsedUrl = new URL(newTab.url);
      const urlQuery = parsedUrl.origin + parsedUrl.pathname + "*"; // Broad enough to catch query/hash variants
      const matchingTabs = await browser.tabs.query({ url: urlQuery });
      
      for (const tab of matchingTabs) {
        if (tab.id === newTab.id) continue;
        if (normalizeUrl(tab.url) === normalizedNewTabUrl) {
          await handleDuplicateTab(tab, newTab);
          return;
        }
      }
    } catch (e) {
      log("Error processing preventDuplicateTabs global setting:", e);
    }
  }
  
  // Check all deduplication rules
  for (const rule of deduplicationRules) {
    if (!rule.enabled) continue;
    
    if (matchesDeduplicationRule(newTab.url, rule)) {
      log(`Deduplication rule matched for tab ${newTab.id}: ${newTab.url}`);
      
      let existingTab = null;
      let matchingTabs = [];

      try {
        if (rule.matchType === 'exact' || rule.matchType === 'path') {
          // For exact or path matching, we need exact URL matches, so we can focus our query
          const parsedUrl = new URL(newTab.url);
          const urlQuery = parsedUrl.origin + parsedUrl.pathname + "*"; 
          matchingTabs = await browser.tabs.query({ url: urlQuery });
        } else if (rule.matchType === 'domain') {
          // For domain match, query any URL on this domain
          const newTabDomain = getDomain(newTab.url);
          if (newTabDomain) {
             matchingTabs = await browser.tabs.query({ url: "*://" + newTabDomain + "/*" });
             // Ensure we also grab subdomains like www. if applicable by matching on the base domain
             // A more comprehensive query if the domain is simply example.com without subdomains
             const subDomainQuery = "*://*." + newTabDomain + "/*";
             const subDomainTabs = await browser.tabs.query({ url: subDomainQuery });
             // Combine but deduplicate by tab ID
             const combinedTabs = [...matchingTabs, ...subDomainTabs];
             const uniqueTabsMap = new Map();
             combinedTabs.forEach(t => uniqueTabsMap.set(t.id, t));
             matchingTabs = Array.from(uniqueTabsMap.values());
          }
        }
      } catch (e) {
        log("Error querying for duplicates for rule:", rule, e);
        continue;
      }
      
      // Now evaluate the matched tabs from the targeted query
      if (rule.matchType === 'exact') {
        for (const tab of matchingTabs) {
          if (tab.id === newTab.id) continue;
          if (normalizeUrl(tab.url) === normalizedNewTabUrl) {
            existingTab = tab;
            break;
          }
        }
      } else if (rule.matchType === 'domain') {
        // Domain match: first try exact URL
        for (const tab of matchingTabs) {
          if (tab.id === newTab.id) continue;
          if (normalizeUrl(tab.url) === normalizedNewTabUrl) {
            existingTab = tab;
            break;
          }
        }
        
        // If no exact match, find any tab from same domain
        if (!existingTab) {
          const newTabDomain = getDomain(newTab.url);
          for (const tab of matchingTabs) {
            if (tab.id === newTab.id || !tab.url) continue;
            
            const tabDomain = getDomain(tab.url);
            if (newTabDomain && tabDomain && newTabDomain.toLowerCase() === tabDomain.toLowerCase()) {
              existingTab = tab;
              break;
            }
          }
        }
      } else if (rule.matchType === 'path') {
        // "Exact per page on domain"
        for (const tab of matchingTabs) {
          if (tab.id === newTab.id || !tab.url) continue;
          if (normalizeUrl(tab.url) === normalizedNewTabUrl) {
            existingTab = tab;
            break;
          }
        }
      }
      
      if (existingTab) {
         await handleDuplicateTab(existingTab, newTab);
         return;
      }
    }
  }
}

async function handleDuplicateTab(existingTab, newTab) {
  const preferGrouped = settings.preferGroupedTabWhenDuplicate && existingTab.groupId !== undefined && existingTab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE;
  if (settings.closeOldTab && !preferGrouped) {
    log(`Found duplicate tab ${existingTab.id} for ${newTab.url}, keeping new tab ${newTab.id} and closing old tab ${existingTab.id}`);
    await browser.tabs.remove(existingTab.id);
  } else {
    log(`Found duplicate tab ${existingTab.id} for ${newTab.url}, activating it and closing ${newTab.id}`);
    await browser.windows.update(existingTab.windowId, { focused: true });
    await browser.tabs.update(existingTab.id, { active: true });
    await browser.tabs.remove(newTab.id);
  }
}

async function analyzeTabsForGrouping() {
  const tabs = await browser.tabs.query({});
  const domainMap = new Map();
  
  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) {
      continue;
    }
    
    const domain = getDomain(tab.url);
    if (!domain) continue;
    
    if (!domainMap.has(domain)) {
      domainMap.set(domain, []);
    }
    domainMap.get(domain).push(tab);
  }
  
  const suggestions = [];
  for (const [domain, domainTabs] of domainMap.entries()) {
    const ungroupedTabs = domainTabs.filter(
      tab => tab.groupId === browser.tabGroups.TAB_GROUP_ID_NONE
    );
    
    if (ungroupedTabs.length >= 1) {
      const existingGroup = await findMatchingGroup(domain);
      suggestions.push({
        domain,
        tabCount: ungroupedTabs.length,
        tabIds: ungroupedTabs.map(t => t.id),
        existingGroup: existingGroup ? existingGroup.title : null
      });
    }
  }
  
  suggestions.sort((a, b) => b.tabCount - a.tabCount);
  return suggestions;
}

async function findMatchingGroup(domain) {
  const allGroups = await browser.tabGroups.query({});
  const domainLower = domain.toLowerCase();
  const domainBase = domainLower.replace(/\.com$|\.org$|\.net$|\.io$|\.co$/, '');
  
  for (const group of allGroups) {
    if (!group.title) continue;
    const titleLower = group.title.toLowerCase();
    const titleBase = titleLower.replace(/\.com$|\.org$|\.net$|\.io$|\.co$/, '');
    
    // Match: "youtube" == "youtube", "youtube.com" == "youtube", "YouTube" == "youtube"
    if (titleLower === domainLower || titleBase === domainBase || titleLower === domainBase || titleBase === domainLower) {
      const tabsInGroup = await browser.tabs.query({ groupId: group.id });
      if (tabsInGroup.length > 0) {
        return group;
      }
    }
  }
  return null;
}

async function groupTabsByDomain(domain, tabIds, customTitle) {
  const existingGroup = await findMatchingGroup(customTitle || domain);
  
  if (existingGroup) {
    await browser.tabs.group({ groupId: existingGroup.id, tabIds });
    log(`Added ${tabIds.length} tabs from ${domain} to existing group "${existingGroup.title}" (${existingGroup.id})`);
    return existingGroup.id;
  }
  
  const groupId = await browser.tabs.group({ tabIds });
  await browser.tabGroups.update(groupId, { title: customTitle || domain });
  log(`Created new group "${customTitle || domain}" (${groupId}) with ${tabIds.length} tabs`);
  return groupId;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settingsChanged') {
    loadSettings();
  } else if (message.type === 'analyzeTabs') {
    analyzeTabsForGrouping()
      .then(suggestions => sendResponse({ success: true, suggestions }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'groupTabs') {
    groupTabsByDomain(message.domain, message.tabIds, message.title)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'getRules') {
    sendResponse({ success: true, rules });
    return false;
  } else if (message.type === 'addRule') {
    const newRule = {
      id: Date.now().toString(),
      pattern: message.pattern,
      groupName: message.groupName,
      enabled: true
    };
    rules.push(newRule);
    saveRules().then(() => sendResponse({ success: true, rule: newRule }));
    return true;
  } else if (message.type === 'deleteRule') {
    rules = rules.filter(r => r.id !== message.ruleId);
    saveRules().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.type === 'toggleRule') {
    const rule = rules.find(r => r.id === message.ruleId);
    if (rule) {
      rule.enabled = !rule.enabled;
      saveRules().then(() => sendResponse({ success: true, enabled: rule.enabled }));
    } else {
      sendResponse({ success: false, error: 'Rule not found' });
    }
    return true;
  } else if (message.type === 'getGroups') {
    browser.tabGroups.query({})
      .then(groups => sendResponse({ success: true, groups: groups.map(g => g.title).filter(Boolean) }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'getDeduplicationRules') {
    sendResponse({ success: true, rules: deduplicationRules });
    return false;
  } else if (message.type === 'addDeduplicationRule') {
    const newRule = {
      id: Date.now().toString(),
      url: message.url,
      matchType: message.matchType, // 'exact', 'domain', or 'path'
      enabled: true
    };
    deduplicationRules.push(newRule);
    saveDeduplicationRules().then(() => sendResponse({ success: true, rule: newRule }));
    return true;
  } else if (message.type === 'deleteDeduplicationRule') {
    deduplicationRules = deduplicationRules.filter(r => r.id !== message.ruleId);
    saveDeduplicationRules().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.type === 'toggleDeduplicationRule') {
    const rule = deduplicationRules.find(r => r.id === message.ruleId);
    if (rule) {
      rule.enabled = !rule.enabled;
      saveDeduplicationRules().then(() => sendResponse({ success: true, enabled: rule.enabled }));
    } else {
      sendResponse({ success: false, error: 'Rule not found' });
    }
    return true;
  } else if (message.type === 'getCurrentTab') {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        if (tabs.length > 0) {
          sendResponse({ success: true, tab: tabs[0] });
        } else {
          sendResponse({ success: false, error: 'No active tab' });
        }
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Apply rules when tabs are created or updated
browser.tabs.onCreated.addListener((tab) => {
  setTimeout(() => {
    applyRulesToTab(tab);
    checkForDuplicateTab(tab);
  }, 500); // Small delay to let URL load
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    applyRulesToTab(tab);
    // Check for duplicates when URL changes (e.g., navigation)
    checkForDuplicateTab(tab);
  }
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    loadSettings();
  }
});

browser.runtime.onInstalled.addListener(() => {
  loadSettings().then(() => {
    log("Extension installed and listening for duplicate tab groups.");
  });
});

// Load settings on startup
loadSettings();
