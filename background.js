const MERGE_IN_PROGRESS = new Set();
const RETRY_COUNTS = new Map();
const MERGE_TIMERS = new Map();
const MERGE_DELAY_MS = 1200;
const MAX_RETRIES = 5;

function log(...args) {
  console.debug("[TabGroupDeduper]", ...args);
}

async function getGroupSafe(groupId) {
  try {
    return await browser.tabGroups.get(groupId);
  } catch (error) {
    if (error && error.message && error.message.includes("No tab group")) {
      log("Group", groupId, "no longer exists; skipping merge.");
      return null;
    }
    console.error("[TabGroupDeduper] Failed to fetch tab group", groupId, error);
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
    console.error("[TabGroupDeduper] Failed to merge duplicate group", error);
  } finally {
    MERGE_IN_PROGRESS.delete(groupId);
  }
}

function scheduleMerge(groupId, reason) {
  if (MERGE_TIMERS.has(groupId)) {
    clearTimeout(MERGE_TIMERS.get(groupId));
  }

  const timerId = setTimeout(() => {
    MERGE_TIMERS.delete(groupId);
    mergeIfDuplicate(groupId);
  }, MERGE_DELAY_MS);

  MERGE_TIMERS.set(groupId, timerId);
  log(`Scheduled merge for group ${groupId} (${reason}) in ${MERGE_DELAY_MS}ms.`);
}

browser.tabGroups.onCreated.addListener((group) => {
  scheduleMerge(group.id, "created");
});

browser.tabGroups.onUpdated.addListener((group) => {
  scheduleMerge(group.id, "updated");
});

browser.runtime.onInstalled.addListener(() => {
  log("Extension installed and listening for duplicate tab groups.");
});

