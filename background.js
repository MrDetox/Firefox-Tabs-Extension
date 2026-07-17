const HAS_TAB_GROUPS = typeof browser.tabGroups !== 'undefined';
const TAB_GROUP_ID_NONE = HAS_TAB_GROUPS ? browser.tabGroups.TAB_GROUP_ID_NONE : -1;

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
  skipDedupeWhenUserDuplicatedTab: true,
  autoCloseDuplicates: true,
  autoCloseDuplicatesInterval: false
};
const MAX_RETRIES = 5;

// Automatic sweeps only run on Android: that's the only platform where unloaded
// tabs hide their URL and stale duplicates pile up. On desktop tabs.query
// already sees them, so we leave desktop tabs alone (the manual button still works).
let isAndroid = false;

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
    settings.autoCloseDuplicates = result.autoCloseDuplicates !== false;
    settings.autoCloseDuplicatesInterval = result.autoCloseDuplicatesInterval === true;
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
  if (!HAS_TAB_GROUPS) return null;
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
  if (!HAS_TAB_GROUPS) return;
  if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) {
    return;
  }
  
  if (tab.groupId !== TAB_GROUP_ID_NONE) {
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
  if (!HAS_TAB_GROUPS) return null;
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
  if (!HAS_TAB_GROUPS) return null;
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

if (HAS_TAB_GROUPS) {
  browser.tabGroups.onCreated.addListener((group) => {
    scheduleMerge(group.id, "created");
  });

  browser.tabGroups.onUpdated.addListener((group) => {
    scheduleMerge(group.id, "updated");
  });
}

function getDomain(url) {
  try {
    let cleanUrl = url;
    if (url && !url.includes('://')) {
      cleanUrl = 'http://' + url;
    }
    const urlObj = new URL(cleanUrl);
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

// --- Zombie-aware URL cache -------------------------------------------------
// Firefox for Android unloads ("zombifies") background tabs to save memory,
// which strips their URL from the tabs API: tabs.query stops matching them and
// tab.url becomes "about:blank". A stale duplicate is then invisible to dedup
// until you open it and reload. We remember each tab's last real URL (in
// storage.session, which survives the background page suspending) so unloaded
// duplicates can still be found and closed by id.
// ponytail: whole-object write per URL change; batch if someone runs 100s of tabs.
const URL_CACHE_KEY = 'tabUrlCache';
let urlCache = {};
const sessionStore = browser.storage.session || browser.storage.local;
let cacheLoadPromise = null;

function ensureCache() {
  if (!cacheLoadPromise) {
    cacheLoadPromise = sessionStore.get(URL_CACHE_KEY)
      .then((r) => { urlCache = (r && r[URL_CACHE_KEY]) || {}; })
      .catch(() => { urlCache = {}; });
  }
  return cacheLoadPromise;
}

function saveUrlCache() {
  return sessionStore.set({ [URL_CACHE_KEY]: urlCache }).catch(() => {});
}

function isRealUrl(url) {
  return !!url && !url.startsWith('about:');
}

async function rememberTabUrl(tab) {
  if (!tab || typeof tab.id !== 'number' || !isRealUrl(tab.url)) return;
  await ensureCache();
  if (urlCache[tab.id] !== tab.url) {
    urlCache[tab.id] = tab.url;
    await saveUrlCache();
  }
}

async function forgetTab(tabId) {
  await ensureCache();
  if (urlCache[tabId] !== undefined) {
    delete urlCache[tabId];
    await saveUrlCache();
  }
}

async function seedUrlCache() {
  await ensureCache();
  try {
    const tabs = await browser.tabs.query({});
    for (const t of tabs) await rememberTabUrl(t);
  } catch (_) {}
}

function sameDomain(a, b) {
  const da = getDomain(a);
  const db = getDomain(b);
  return !!da && !!db && da.toLowerCase() === db.toLowerCase();
}

// All tabs, with unloaded/zombie tabs' missing URLs filled in from the cache.
async function getCandidateTabs() {
  await ensureCache();
  const live = await browser.tabs.query({});
  const byId = new Map();
  for (const t of live) {
    const url = isRealUrl(t.url) ? t.url : urlCache[t.id];
    byId.set(t.id, { ...t, url });
  }
  // Older Android builds omit unloaded tabs from query entirely; add them back.
  for (const idStr of Object.keys(urlCache)) {
    const id = Number(idStr);
    if (!byId.has(id)) {
      byId.set(id, { id, url: urlCache[idStr], windowId: undefined, groupId: TAB_GROUP_ID_NONE, discarded: true });
    }
  }
  return Array.from(byId.values());
}

// Exact URL match wins for every rule type; 'domain' rules fall back to any
// other tab on the same host.
function findDuplicateCandidate(newTab, normalizedNewUrl, candidates, matchType) {
  const newDomain = matchType === 'domain' ? getDomain(newTab.url) : null;
  let domainFallback = null;
  for (const c of candidates) {
    if (c.id === newTab.id || !isRealUrl(c.url)) continue;
    if (normalizeUrl(c.url) === normalizedNewUrl) return c;
    if (matchType === 'domain' && !domainFallback && newDomain) {
      const cDomain = getDomain(c.url);
      if (cDomain && cDomain.toLowerCase() === newDomain.toLowerCase()) domainFallback = c;
    }
  }
  return matchType === 'domain' ? domainFallback : null;
}

// Turn a candidate into a live tab, re-checking the match in case an unloaded
// tab woke up and navigated away since we cached its URL (never close the wrong tab).
async function resolveDuplicate(candidate, newTab, normalizedNewUrl, matchType) {
  let tab;
  try {
    tab = await browser.tabs.get(candidate.id);
  } catch (_) {
    forgetTab(candidate.id);
    return null;
  }
  let url = tab.url;
  if (isRealUrl(url)) rememberTabUrl(tab);
  else url = urlCache[candidate.id];        // still unloaded: trust the cache
  if (!isRealUrl(url)) { forgetTab(candidate.id); return null; }

  const stillMatches = normalizeUrl(url) === normalizedNewUrl ||
    (matchType === 'domain' && sameDomain(url, newTab.url));
  if (!stillMatches) return null;
  return { ...tab, url };
}

async function checkForDuplicateTab(newTab) {
  const myExtensionOrigin = browser.runtime.getURL('');
  if (!newTab.url || newTab.url.startsWith('about:') || newTab.url.startsWith(myExtensionOrigin)) {
    return;
  }

  rememberTabUrl(newTab);
  const normalizedNewTabUrl = normalizeUrl(newTab.url);

  // If this tab was created via "Duplicate Tab", the browser sets openerTabId
  // to the source tab. Skip dedup so we don't undo the user's action.
  if (settings.skipDedupeWhenUserDuplicatedTab && newTab.openerTabId != null) {
    try {
      const openerTab = await browser.tabs.get(newTab.openerTabId);
      if (openerTab && openerTab.url && normalizeUrl(openerTab.url) === normalizedNewTabUrl) {
        log("Tab", newTab.id, "is a user-duplicated tab; skipping deduplication.");
        return;
      }
    } catch (_) {
      // Opener tab no longer exists, proceed with normal deduplication
    }
  }

  let candidates = null;
  const getCandidates = async () => (candidates ||= await getCandidateTabs());

  const tryHandle = async (matchType) => {
    const dup = findDuplicateCandidate(newTab, normalizedNewTabUrl, await getCandidates(), matchType);
    if (!dup) return false;
    const existingTab = await resolveDuplicate(dup, newTab, normalizedNewTabUrl, matchType);
    if (!existingTab) return false;
    await handleDuplicateTab(existingTab, newTab);
    return true;
  };

  // Global setting: prevent any duplicate tabs with the exact same URL.
  if (settings.preventDuplicateTabs && await tryHandle('exact')) return;

  // Per-URL deduplication rules.
  for (const rule of deduplicationRules) {
    if (!rule.enabled) continue;
    if (!matchesDeduplicationRule(newTab.url, rule)) continue;
    log(`Deduplication rule matched for tab ${newTab.id}: ${newTab.url}`);
    if (await tryHandle(rule.matchType)) return;
  }
}

async function handleDuplicateTab(existingTab, newTab) {
  const preferGrouped = settings.preferGroupedTabWhenDuplicate && existingTab.groupId !== undefined && existingTab.groupId !== TAB_GROUP_ID_NONE;
  if (settings.closeOldTab && !preferGrouped) {
    log(`Found duplicate tab ${existingTab.id} for ${newTab.url}, keeping new tab ${newTab.id} and closing old tab ${existingTab.id}`);
    await browser.tabs.remove(existingTab.id);
  } else {
    log(`Found duplicate tab ${existingTab.id} for ${newTab.url}, activating it and closing ${newTab.id}`);
    try {
      if (browser.windows && typeof browser.windows.update === 'function') {
        await browser.windows.update(existingTab.windowId, { focused: true });
      }
    } catch (err) {
      log("Failed to focus window (not supported on this platform):", err);
    }
    await browser.tabs.update(existingTab.id, { active: true });
    await browser.tabs.remove(newTab.id);
  }
}

// --- Proactive sweep --------------------------------------------------------
// Closes existing exact-URL duplicate tabs, keeping one per URL. Unlike the
// on-open dedup, this cleans up duplicates that are already sitting there
// (including Android's unloaded tabs, whose URL we know from the cache).
// Removing an unloaded tab by id does NOT wake it, so this stays cheap.
// ponytail: exact-URL only; domain "single tab limit" rules still fire on open,
// not here, to avoid a sweep nuking many tabs at once.
function isGrouped(tab) {
  return HAS_TAB_GROUPS && tab.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE;
}

function pickKeeper(tabs) {
  return tabs.reduce((best, t) => {
    if (!best) return t;
    // Keep a loaded tab over an unloaded one.
    if (!!best.discarded !== !!t.discarded) return best.discarded ? t : best;
    // Optionally keep a tab that's filed in a group.
    if (settings.preferGroupedTabWhenDuplicate && isGrouped(best) !== isGrouped(t)) {
      return isGrouped(t) ? t : best;
    }
    // Otherwise keep the most recently used.
    return (t.lastAccessed || 0) > (best.lastAccessed || 0) ? t : best;
  }, null);
}

async function stillMatches(id, matchFn) {
  try {
    const t = await browser.tabs.get(id);
    if (isRealUrl(t.url)) { rememberTabUrl(t); return matchFn(t.url); }
  } catch (_) {
    forgetTab(id);
    return false;
  }
  // Unloaded: trust the cached URL (don't wake it just to verify).
  return isRealUrl(urlCache[id]) && matchFn(urlCache[id]);
}

async function sweepGroups(groups, matchFnFor, alreadyClosed) {
  let closed = 0;
  for (const [key, tabs] of groups) {
    const remaining = tabs.filter((t) => !alreadyClosed.has(t.id));
    if (remaining.length < 2) continue;
    const keeper = pickKeeper(remaining);
    for (const t of remaining) {
      if (t.id === keeper.id) continue;
      if (!(await stillMatches(t.id, matchFnFor(key)))) continue;
      try { await browser.tabs.remove(t.id); alreadyClosed.add(t.id); closed++; }
      catch (_) { forgetTab(t.id); }
    }
  }
  return closed;
}

async function sweepDuplicates() {
  const myExtensionOrigin = browser.runtime.getURL('');
  const candidates = [];
  for (const t of await getCandidateTabs()) {
    if (isRealUrl(t.url) && !t.url.startsWith(myExtensionOrigin)) candidates.push(t);
  }
  const alreadyClosed = new Set();

  // Pass 1: exact-URL duplicates.
  const byUrl = new Map();
  for (const t of candidates) {
    const key = normalizeUrl(t.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(t);
  }
  let closed = await sweepGroups(byUrl, (key) => (u) => normalizeUrl(u) === key, alreadyClosed);

  // Pass 2: "Single Tab Limit" domain rules — one tab per limited domain.
  const limitedDomains = new Set();
  for (const rule of deduplicationRules) {
    if (rule.enabled && rule.matchType === 'domain' && rule.url) {
      const d = getDomain(rule.url);
      if (d) limitedDomains.add(d.toLowerCase());
    }
  }
  if (limitedDomains.size) {
    const byDomain = new Map();
    for (const t of candidates) {
      const d = getDomain(t.url);
      if (!d || !limitedDomains.has(d.toLowerCase())) continue;
      if (!byDomain.has(d.toLowerCase())) byDomain.set(d.toLowerCase(), []);
      byDomain.get(d.toLowerCase()).push(t);
    }
    closed += await sweepGroups(
      byDomain,
      (domain) => (u) => (getDomain(u) || '').toLowerCase() === domain,
      alreadyClosed
    );
  }

  if (closed) log(`Sweep closed ${closed} duplicate tab(s).`);
  return closed;
}

// Deep clean: wake ("reload") every unloaded tab whose URL we don't know, so
// even tabs restored from before the extension existed become visible, then
// run the normal sweep. Costs data/CPU per woken tab, so it's manual-only.
// ponytail: sequential wake, ~8s timeout per tab; parallelize if people run 50+ zombies.
async function deepSweepDuplicates() {
  await ensureCache();
  const tabs = await browser.tabs.query({});
  const unknown = tabs.filter((t) => !isRealUrl(t.url) && !isRealUrl(urlCache[t.id]));
  let woken = 0;

  for (const t of unknown) {
    try {
      await browser.tabs.reload(t.id);
      for (let i = 0; i < 27; i++) {           // poll up to ~8s for the URL to appear
        await new Promise((r) => setTimeout(r, 300));
        const cur = await browser.tabs.get(t.id);
        if (isRealUrl(cur.url)) { await rememberTabUrl(cur); woken++; break; }
      }
    } catch (_) { /* tab vanished mid-reload; nothing to do */ }
  }

  log(`Deep sweep woke ${woken}/${unknown.length} unloaded tab(s).`);
  const closed = await sweepDuplicates();
  return { woken, closed };
}

async function analyzeTabsForGrouping() {
  if (!HAS_TAB_GROUPS) return [];
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
      tab => tab.groupId === TAB_GROUP_ID_NONE
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
  if (!HAS_TAB_GROUPS) return null;
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
  if (!HAS_TAB_GROUPS) return null;
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
    if (!HAS_TAB_GROUPS) {
      sendResponse({ success: true, groups: [] });
      return false;
    }
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
  } else if (message.type === 'sweepDuplicates') {
    sweepDuplicates()
      .then(closed => sendResponse({ success: true, closed }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'deepSweepDuplicates') {
    deepSweepDuplicates()
      .then(result => sendResponse({ success: true, ...result }))
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

// On Android an unloaded ("zombie") tab regains its URL when reopened. That's
// our chance to reconcile a stale duplicate that was invisible while unloaded,
// without the user having to manually reload it.
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await browser.tabs.get(tabId);
    rememberTabUrl(tab);
    if (isRealUrl(tab.url)) checkForDuplicateTab(tab);
  } catch (_) {}
});

// Keep the URL cache from growing unbounded.
browser.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    loadSettings();
  }
});

browser.runtime.onInstalled.addListener(() => {
  loadSettings().then(() => {
    log("Extension installed.");
    initBrowserAction();
  });
});

async function initBrowserAction() {
  try {
    const platform = await browser.runtime.getPlatformInfo();
    isAndroid = platform.os === 'android';
    if (isAndroid) {
      if (browser.browserAction && typeof browser.browserAction.setPopup === 'function') {
        await browser.browserAction.setPopup({ popup: "" });
      }
    }
  } catch (err) {
    log("Failed to initialize browser action:", err);
  }
  return isAndroid;
}

async function openSettings() {
  const optionsUrl = browser.runtime.getURL("popup.html");
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.startsWith(optionsUrl)) {
      await browser.tabs.update(tab.id, { active: true });
      return;
    }
  }
  await browser.tabs.create({ url: optionsUrl });
}

if (browser.browserAction && browser.browserAction.onClicked) {
  browser.browserAction.onClicked.addListener(() => {
    openSettings().catch((err) => {
      log("Failed to open settings tab:", err);
      try {
        browser.runtime.openOptionsPage();
      } catch (_) {}
    });
  });
}

// Periodic auto-sweep (Android only, and only when the user opted into intervals).
if (browser.alarms) {
  browser.alarms.create('sweepDuplicates', { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sweepDuplicates' && isAndroid &&
        settings.enabled && settings.autoCloseDuplicates && settings.autoCloseDuplicatesInterval) {
      sweepDuplicates();
    }
  });
}

// Load settings + detect platform + seed the URL cache on startup, then run the
// startup sweep on Android if enabled.
Promise.all([loadSettings(), initBrowserAction()])
  .then(() => seedUrlCache())
  .then(() => {
    if (isAndroid && settings.enabled && settings.autoCloseDuplicates) sweepDuplicates();
  });
