const DEFAULT_SETTINGS = {
  enabled: true,
  debounceTime: 1200,
  preventDuplicateTabs: false,
  closeOldTab: false,
  preferGroupedTabWhenDuplicate: false,
  skipDedupeWhenUserDuplicatedTab: true
};

const FEEDBACK_EMAIL = 'denis.duchev@gmail.com';
// Set to your Buy Me a Coffee page URL, e.g. https://www.buymeacoffee.com/yourusername
const DONATE_URL = 'https://buymeacoffee.com/denisd';

// Store suggestions data
let domainSuggestions = [];
let groupSuggestions = [];
let urlSuggestions = [];

// Collapsible sections
document.querySelectorAll('.section-header').forEach(header => {
  header.addEventListener('click', () => {
    header.parentElement.classList.toggle('open');
  });
});

// Example tooltips: show after 200ms hover to avoid flash on quick pass
const TOOLTIP_DELAY_MS = 200;
document.querySelectorAll('.setting-label-line').forEach(el => {
  let delayId = null;
  el.addEventListener('mouseenter', () => {
    delayId = setTimeout(() => el.classList.add('example-tooltip-visible'), TOOLTIP_DELAY_MS);
  });
  el.addEventListener('mouseleave', () => {
    if (delayId) clearTimeout(delayId);
    delayId = null;
    el.classList.remove('example-tooltip-visible');
  });
});

// ============ Combobox Logic ============
function setupCombobox(comboboxId, inputId, dropdownId, getSuggestions) {
  const combobox = document.getElementById(comboboxId);
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  function renderDropdown() {
    const suggestions = getSuggestions();
    const filter = input.value.toLowerCase();

    if (suggestions.length === 0) {
      dropdown.innerHTML = '<div class="combobox-empty">No options available</div>';
      return;
    }

    const filtered = filter
      ? suggestions.filter(s => s.toLowerCase().includes(filter))
      : suggestions;

    if (filtered.length === 0) {
      dropdown.innerHTML = '<div class="combobox-empty">No matches</div>';
      return;
    }

    dropdown.innerHTML = '<div class="combobox-header">Choose or type your own</div>';
    filtered.forEach(item => {
      const option = document.createElement('div');
      option.className = 'combobox-option';
      option.textContent = item;
      option.addEventListener('click', () => {
        input.value = item;
        closeDropdown();
        input.focus();
      });
      dropdown.appendChild(option);
    });
  }

  function openDropdown() {
    renderDropdown();
    combobox.classList.add('open');
  }

  function closeDropdown() {
    combobox.classList.remove('open');
  }

  // Open on focus/click
  input.addEventListener('focus', openDropdown);
  input.addEventListener('click', openDropdown);

  // Filter as user types
  input.addEventListener('input', () => {
    if (combobox.classList.contains('open')) {
      renderDropdown();
    }
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown();
    } else if (e.key === 'ArrowDown' && combobox.classList.contains('open')) {
      e.preventDefault();
      const options = dropdown.querySelectorAll('.combobox-option');
      if (options.length > 0) {
        const highlighted = dropdown.querySelector('.highlighted');
        if (highlighted) {
          highlighted.classList.remove('highlighted');
          const next = highlighted.nextElementSibling;
          if (next && next.classList.contains('combobox-option')) {
            next.classList.add('highlighted');
            next.scrollIntoView({ block: 'nearest' });
          } else {
            options[0].classList.add('highlighted');
          }
        } else {
          options[0].classList.add('highlighted');
        }
      }
    } else if (e.key === 'ArrowUp' && combobox.classList.contains('open')) {
      e.preventDefault();
      const options = dropdown.querySelectorAll('.combobox-option');
      if (options.length > 0) {
        const highlighted = dropdown.querySelector('.highlighted');
        if (highlighted) {
          highlighted.classList.remove('highlighted');
          const prev = highlighted.previousElementSibling;
          if (prev && prev.classList.contains('combobox-option')) {
            prev.classList.add('highlighted');
            prev.scrollIntoView({ block: 'nearest' });
          } else {
            options[options.length - 1].classList.add('highlighted');
          }
        } else {
          options[options.length - 1].classList.add('highlighted');
        }
      }
    } else if (e.key === 'Enter') {
      const highlighted = dropdown.querySelector('.highlighted');
      if (highlighted && combobox.classList.contains('open')) {
        e.preventDefault();
        input.value = highlighted.textContent;
        closeDropdown();
      }
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!combobox.contains(e.target)) {
      closeDropdown();
    }
  });
}

// ============ Settings ============
async function loadSettings() {
  try {
    const result = await browser.storage.sync.get(DEFAULT_SETTINGS);
    document.getElementById('enabled').checked = result.enabled !== false;
    document.getElementById('debounceTime').value = result.debounceTime || DEFAULT_SETTINGS.debounceTime;
    document.getElementById('preventDuplicateTabs').checked = result.preventDuplicateTabs === true;
    document.getElementById('closeOldTab').checked = result.closeOldTab === true;
    document.getElementById('preferGroupedTabWhenDuplicate').checked = result.preferGroupedTabWhenDuplicate === true;
    document.getElementById('skipDedupeWhenUserDuplicatedTab').checked = result.skipDedupeWhenUserDuplicatedTab !== false;
    updateCloseOldTabSuboptionVisibility();
    updateSkipDedupeWhenUserDuplicatedTabVisibility();
  } catch (error) {
    console.error('Failed to load settings:', error);
    showStatus('Failed to load settings', 'error');
  }
}

async function saveSettings() {
  try {
    const enabled = document.getElementById('enabled').checked;
    const debounceTime = parseInt(document.getElementById('debounceTime').value, 10);
    const preventDuplicateTabs = document.getElementById('preventDuplicateTabs').checked;
    const closeOldTab = document.getElementById('closeOldTab').checked;
    const preferGroupedTabWhenDuplicate = document.getElementById('preferGroupedTabWhenDuplicate').checked;
    const skipDedupeWhenUserDuplicatedTab = document.getElementById('skipDedupeWhenUserDuplicatedTab').checked;

    if (isNaN(debounceTime) || debounceTime < 0 || debounceTime > 10000) {
      showStatus('Debounce time must be between 0 and 10000 ms', 'error');
      return;
    }

    await browser.storage.sync.set({ enabled, debounceTime, preventDuplicateTabs, closeOldTab, preferGroupedTabWhenDuplicate, skipDedupeWhenUserDuplicatedTab });
    showStatus('Settings saved!', 'success');
    browser.runtime.sendMessage({ type: 'settingsChanged' }).catch(() => { });
  } catch (error) {
    console.error('Failed to save settings:', error);
    showStatus('Failed to save settings', 'error');
  }
}

function updateCloseOldTabSuboptionVisibility() {
  const row = document.getElementById('preferGroupedRow');
  const closeOldTab = document.getElementById('closeOldTab');
  row.style.display = closeOldTab && closeOldTab.checked ? '' : 'none';
}

function updateSkipDedupeWhenUserDuplicatedTabVisibility() {
  const row = document.getElementById('skipDedupeWhenUserDuplicatedTabRow');
  const preventDuplicateTabs = document.getElementById('preventDuplicateTabs');
  row.style.display = preventDuplicateTabs && preventDuplicateTabs.checked ? '' : 'none';
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
  setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ Load Suggestions Data ============
async function loadSuggestionsData() {
  try {
    // Get domains and URLs from open tabs
    const tabs = await browser.tabs.query({});
    const domains = new Set();
    const urls = [];
    for (const tab of tabs) {
      if (tab.url && !tab.url.startsWith('about:') && !tab.url.startsWith('moz-extension:')) {
        try {
          const url = new URL(tab.url);
          const domain = url.hostname.replace(/^www\./, '');
          if (domain) {
            domains.add(domain);
          }
          urls.push(tab.url);
        } catch (e) { }
      }
    }
    domainSuggestions = [...domains].sort();
    urlSuggestions = urls.sort();

    // Get existing group names
    const groupsRes = await browser.runtime.sendMessage({ type: 'getGroups' });
    if (groupsRes.success) {
      groupSuggestions = [...new Set(groupsRes.groups)].sort();
    }
  } catch (e) {
    console.error('Failed to load suggestions data:', e);
  }
}

// ============ Rules ============
async function loadRules() {
  const container = document.getElementById('rules');
  const badge = document.getElementById('ruleCount');

  try {
    const response = await browser.runtime.sendMessage({ type: 'getRules' });

    if (!response.success) {
      container.innerHTML = '<div class="empty-state">Failed to load rules</div>';
      badge.textContent = '0';
      return;
    }

    const rules = response.rules || [];
    badge.textContent = rules.length;

    if (rules.length === 0) {
      container.innerHTML = '<div class="empty-state">No rules yet. Add one above!</div>';
      return;
    }

    container.innerHTML = '';
    const template = document.getElementById('ruleTemplate');

    for (const rule of rules) {
      const clone = template.content.cloneNode(true);
      const item = clone.querySelector('.rule-item');

      if (!rule.enabled) item.classList.add('disabled');

      clone.querySelector('.rule-pattern').textContent = rule.pattern;
      clone.querySelector('.rule-target').textContent = rule.groupName;

      const toggleBtn = clone.querySelector('.toggle-btn');
      toggleBtn.textContent = rule.enabled ? 'On' : 'Off';
      toggleBtn.addEventListener('click', async () => {
        const res = await browser.runtime.sendMessage({ type: 'toggleRule', ruleId: rule.id });
        if (res.success) loadRules();
      });

      const deleteBtn = clone.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', async () => {
        const res = await browser.runtime.sendMessage({ type: 'deleteRule', ruleId: rule.id });
        if (res.success) {
          showStatus('Rule deleted', 'success');
          loadRules();
        }
      });

      container.appendChild(clone);
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Error loading rules</div>';
    badge.textContent = '0';
  }
}

async function addRule() {
  const patternInput = document.getElementById('rulePattern');
  const groupInput = document.getElementById('ruleGroup');
  const pattern = patternInput.value.trim();
  const groupName = groupInput.value.trim();

  if (!pattern || !groupName) {
    showStatus('Enter both domain and group name', 'error');
    return;
  }

  // Close any open dropdowns
  document.querySelectorAll('.combobox').forEach(cb => cb.classList.remove('open'));

  try {
    const res = await browser.runtime.sendMessage({ type: 'addRule', pattern, groupName });

    if (res.success) {
      patternInput.value = '';
      groupInput.value = '';
      showStatus('Rule added!', 'success');
      loadRules();
      loadSuggestionsData();
    } else {
      showStatus('Failed to add rule', 'error');
    }
  } catch (e) {
    showStatus('Failed to add rule', 'error');
  }
}

// ============ Quick Group Suggestions ============
async function loadQuickGroupSuggestions() {
  const container = document.getElementById('suggestions');
  const badge = document.getElementById('suggestionCount');
  container.innerHTML = '<div class="empty-state">Analyzing...</div>';

  try {
    const response = await browser.runtime.sendMessage({ type: 'analyzeTabs' });

    if (!response.success) {
      container.innerHTML = '<div class="empty-state">Failed to analyze tabs</div>';
      badge.textContent = '0';
      return;
    }

    const suggestions = response.suggestions || [];
    const validSuggestions = suggestions.filter(s => s.tabCount >= 2 || s.existingGroup);
    badge.textContent = validSuggestions.length;

    if (validSuggestions.length === 0) {
      container.innerHTML = '<div class="empty-state">No suggestions available</div>';
      return;
    }

    container.innerHTML = '';
    const template = document.getElementById('suggestionTemplate');

    for (const s of validSuggestions) {
      const clone = template.content.cloneNode(true);

      const actionText = s.existingGroup ? `Add to "${s.existingGroup}"` : 'Group';
      const countText = s.tabCount === 1 ? '1 tab' : `${s.tabCount} tabs`;

      const nameInput = clone.querySelector('.suggestion-name-input');
      nameInput.value = s.suggestedName;
      nameInput.title = 'Click to rename group';
      
      clone.querySelector('.suggestion-count').textContent = countText;

      const btn = clone.querySelector('.group-btn');
      btn.textContent = actionText;
      btn.addEventListener('click', async () => {
        const groupName = nameInput.value.trim();
        if (!groupName) {
          showStatus('Please enter a group name', 'error');
          return;
        }
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const res = await browser.runtime.sendMessage({
            type: 'groupTabs',
            domain: s.domain,
            groupName: groupName,
            tabIds: s.tabIds
          });
          if (res.success) {
            showStatus(`Grouped ${s.tabCount} tab${s.tabCount > 1 ? 's' : ''}!`, 'success');
            setTimeout(() => {
              loadQuickGroupSuggestions();
              loadSuggestionsData();
            }, 300);
          } else {
            showStatus('Failed to group', 'error');
            btn.disabled = false;
            btn.textContent = actionText;
          }
        } catch (e) {
          showStatus('Failed to group', 'error');
          btn.disabled = false;
          btn.textContent = actionText;
        }
      });

      container.appendChild(clone);
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Error loading suggestions</div>';
    badge.textContent = '0';
  }
}

// ============ Deduplication Rules ============
async function loadDeduplicationRules() {
  const container = document.getElementById('deduplicationRules');
  const badge = document.getElementById('deduplicationCount');

  try {
    const response = await browser.runtime.sendMessage({ type: 'getDeduplicationRules' });

    if (!response.success) {
      container.innerHTML = '<div class="empty-state">Failed to load rules</div>';
      badge.textContent = '0';
      return;
    }

    const rules = response.rules || [];
    badge.textContent = rules.length;

    if (rules.length === 0) {
      container.innerHTML = '<div class="empty-state">No deduplication rules yet. Add one above!</div>';
      return;
    }

    container.innerHTML = '';
    const template = document.getElementById('dedupeRuleTemplate');

    for (const rule of rules) {
      const clone = template.content.cloneNode(true);
      const item = clone.querySelector('.rule-item');

      if (!rule.enabled) item.classList.add('disabled');

      const urlSpan = clone.querySelector('.rule-pattern');
      urlSpan.textContent = rule.url;
      urlSpan.title = rule.url; // Tooltip

      const matchTypeLabels = {
        exact: 'Exact',
        domain: 'Domain',
        path: 'Path'
      };
      const matchTypeSpan = clone.querySelector('.rule-match-type');
      matchTypeSpan.textContent = `(${matchTypeLabels[rule.matchType] || rule.matchType})`;

      const toggleBtn = clone.querySelector('.toggle-btn');
      toggleBtn.textContent = rule.enabled ? 'On' : 'Off';
      toggleBtn.addEventListener('click', async () => {
        const res = await browser.runtime.sendMessage({ type: 'toggleDeduplicationRule', ruleId: rule.id });
        if (res.success) loadDeduplicationRules();
      });

      const deleteBtn = clone.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', async () => {
        const res = await browser.runtime.sendMessage({ type: 'deleteDeduplicationRule', ruleId: rule.id });
        if (res.success) {
          showStatus('Rule deleted', 'success');
          loadDeduplicationRules();
        }
      });

      container.appendChild(clone);
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Error loading rules</div>';
    badge.textContent = '0';
  }
}

async function useCurrentTabForDeduplication() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getCurrentTab' });
    if (response.success && response.tab && response.tab.url) {
      const urlInput = document.getElementById('deduplicationUrl');
      urlInput.value = response.tab.url;
      showStatus('Current tab URL loaded', 'success');
    } else {
      showStatus('Could not get current tab', 'error');
    }
  } catch (e) {
    showStatus('Failed to get current tab', 'error');
  }
}

async function useCurrentTabForGrouping() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getCurrentTab' });
    if (response.success && response.tab && response.tab.url) {
      try {
        const url = new URL(response.tab.url);
        const domain = url.hostname.replace(/^www\./, '');
        if (domain) {
          const patternInput = document.getElementById('rulePattern');
          patternInput.value = domain;
          showStatus('Current tab domain loaded', 'success');
        } else {
          showStatus('Could not extract domain from current tab', 'error');
        }
      } catch (e) {
        showStatus('Invalid URL in current tab', 'error');
      }
    } else {
      showStatus('Could not get current tab', 'error');
    }
  } catch (e) {
    showStatus('Failed to get current tab', 'error');
  }
}

async function addDeduplicationRule() {
  const urlInput = document.getElementById('deduplicationUrl');
  const matchTypeSelect = document.getElementById('deduplicationMatchType');
  const url = urlInput.value.trim();
  const matchType = matchTypeSelect.value;

  if (!url) {
    showStatus('Enter a URL', 'error');
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    showStatus('Invalid URL format', 'error');
    return;
  }

  // Close any open dropdowns
  document.querySelectorAll('.combobox').forEach(cb => cb.classList.remove('open'));

  try {
    const res = await browser.runtime.sendMessage({
      type: 'addDeduplicationRule',
      url: url,
      matchType: matchType
    });

    if (res.success) {
      urlInput.value = '';
      showStatus('Deduplication rule added!', 'success');
      loadDeduplicationRules();
      loadSuggestionsData();
    } else {
      showStatus('Failed to add rule', 'error');
    }
  } catch (e) {
    showStatus('Failed to add rule', 'error');
  }
}

// ============ Feedback ============
function setupFeedbackLink() {
  const manifest = browser.runtime.getManifest();
  const version = manifest.version || '?';
  const subject = encodeURIComponent('Better Tab Groups - Feedback');
  const body = encodeURIComponent(
    'Type: [Bug / Feature request / Other]\n\nYour message:\n\n\n---\nBetter Tab Groups v' + version
  );
  const link = document.getElementById('feedbackLink');
  link.href = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
}

function setupDonateLink() {
  const link = document.getElementById('donateLink');
  if (DONATE_URL && DONATE_URL.includes('buymeacoffee.com') && !DONATE_URL.includes('yourusername')) {
    link.href = DONATE_URL;
  } else {
    link.style.display = 'none';
  }
}

// ============ Initialize ============
async function init() {
  loadSettings();
  await loadSuggestionsData();

  // Setup comboboxes with the loaded data
  setupCombobox('domainCombobox', 'rulePattern', 'domainDropdown', () => domainSuggestions);
  setupCombobox('groupCombobox', 'ruleGroup', 'groupDropdown', () => groupSuggestions);
  setupCombobox('urlCombobox', 'deduplicationUrl', 'urlDropdown', () => urlSuggestions);

  loadRules();
  loadQuickGroupSuggestions();
  loadDeduplicationRules();

  setupFeedbackLink();
  setupDonateLink();

  // Setup deduplication rule handlers
  document.getElementById('useCurrentTabBtn').addEventListener('click', useCurrentTabForDeduplication);
  document.getElementById('addDeduplicationBtn').addEventListener('click', addDeduplicationRule);

  // Setup grouping rule handlers
  document.getElementById('useCurrentTabForGroupingBtn').addEventListener('click', useCurrentTabForGrouping);
}

init();

// Event listeners
document.getElementById('addRuleBtn').addEventListener('click', addRule);
document.getElementById('rulePattern').addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !document.getElementById('domainCombobox').classList.contains('open')) {
    addRule();
  }
});
document.getElementById('ruleGroup').addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !document.getElementById('groupCombobox').classList.contains('open')) {
    addRule();
  }
});
document.getElementById('enabled').addEventListener('change', saveSettings);
document.getElementById('debounceTime').addEventListener('change', saveSettings);
document.getElementById('preventDuplicateTabs').addEventListener('change', () => {
  updateSkipDedupeWhenUserDuplicatedTabVisibility();
  saveSettings();
});
document.getElementById('closeOldTab').addEventListener('change', () => {
  updateCloseOldTabSuboptionVisibility();
  saveSettings();
});
document.getElementById('preferGroupedTabWhenDuplicate').addEventListener('change', saveSettings);
document.getElementById('skipDedupeWhenUserDuplicatedTab').addEventListener('change', saveSettings);