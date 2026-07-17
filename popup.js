const DEFAULT_SETTINGS = {
  enabled: true,
  debounceTime: 1200,
  preventDuplicateTabs: false,
  closeOldTab: false,
  preferGroupedTabWhenDuplicate: false,
  skipDedupeWhenUserDuplicatedTab: true,
  autoCloseDuplicates: true,
  autoCloseDuplicatesInterval: false
};

const FEEDBACK_EMAIL = 'denis.duchev@gmail.com';
// Set to your Buy Me a Coffee page URL, e.g. https://www.buymeacoffee.com/yourusername
const DONATE_URL = 'https://buymeacoffee.com/denisd';

// Store suggestions data
let domainSuggestions = [];
let groupSuggestions = [];
let urlSuggestions = [];
let isAndroidDevice = false;

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
    document.getElementById('autoCloseDuplicates').checked = result.autoCloseDuplicates !== false;
    document.getElementById('autoCloseDuplicatesInterval').checked = result.autoCloseDuplicatesInterval === true;
    updateCloseOldTabSuboptionVisibility();
    updateAutoCloseSuboptionVisibility();
    updateSkipDedupeWhenUserDuplicatedTabVisibility();
    updatePathRulesSectionState();
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
    const autoCloseDuplicates = document.getElementById('autoCloseDuplicates').checked;
    const autoCloseDuplicatesInterval = document.getElementById('autoCloseDuplicatesInterval').checked;

    if (isNaN(debounceTime) || debounceTime < 0 || debounceTime > 10000) {
      showStatus('Debounce time must be between 0 and 10000 ms', 'error');
      return;
    }

    await browser.storage.sync.set({ enabled, debounceTime, preventDuplicateTabs, closeOldTab, preferGroupedTabWhenDuplicate, skipDedupeWhenUserDuplicatedTab, autoCloseDuplicates, autoCloseDuplicatesInterval });
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

function updateAutoCloseSuboptionVisibility() {
  const row = document.getElementById('autoCloseIntervalRow');
  const autoClose = document.getElementById('autoCloseDuplicates');
  row.style.display = autoClose && autoClose.checked ? '' : 'none';
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
function stripTld(domain) {
  return domain.replace(/\.(com|org|net|io|co|edu|gov|co\.uk|ai|app|dev|me|us)$/i, '');
}

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

      const defaultTitle = s.existingGroup ? s.existingGroup : stripTld(s.domain);
      const actionText = s.existingGroup ? `Add to "${s.existingGroup}"` : `Add to "${defaultTitle}"`;
      const countText = s.tabCount === 1 ? '1 tab' : `${s.tabCount} tabs`;

      clone.querySelector('.suggestion-domain').textContent = s.domain;
      clone.querySelector('.suggestion-count').textContent = countText;

      const btnContainer = clone.querySelector('.group-btn-container');
      const btnMain = clone.querySelector('.group-btn-main');
      const btnTextSpan = clone.querySelector('.btn-text');
      const btnPrefix = clone.querySelector('.btn-prefix');
      const btnQuotes = clone.querySelectorAll('.btn-quote');
      const groupNameInput = clone.querySelector('.group-name-input');
      const btnSeparator = clone.querySelector('.group-btn-separator');
      const btnEdit = clone.querySelector('.group-btn-edit');
      
      let currentTitle = defaultTitle;

      const setButtonTextState = (title, loading = false) => {
        if (loading) {
           btnContainer.classList.add('loading');
           btnTextSpan.textContent = '...';
        } else {
           btnContainer.classList.remove('loading');
           btnTextSpan.textContent = title;
        }
      };

      setButtonTextState(currentTitle);

      const performGroupAction = async () => {
        if (btnContainer.classList.contains('disabled') || btnContainer.classList.contains('editing')) return;
        
        btnContainer.classList.add('disabled');
        setButtonTextState(currentTitle, true);
        
        try {
          const res = await browser.runtime.sendMessage({
            type: 'groupTabs',
            domain: s.domain,
            tabIds: s.tabIds,
            title: currentTitle
          });
          if (res.success) {
            showStatus(`Grouped ${s.tabCount} tab${s.tabCount > 1 ? 's' : ''}!`, 'success');
            setTimeout(() => {
              loadQuickGroupSuggestions();
              loadSuggestionsData();
            }, 300);
          } else {
            showStatus('Failed to group', 'error');
            btnContainer.classList.remove('disabled');
            setButtonTextState(currentTitle);
          }
        } catch (e) {
          showStatus('Failed to group', 'error');
          btnContainer.classList.remove('disabled');
          setButtonTextState(currentTitle);
        }
      };

      // Click on the main part of the button triggers the action
      btnMain.addEventListener('click', (e) => {
        // Prevent triggering if clicking the input while it's active
        if (e.target === groupNameInput) return;
        performGroupAction();
      });

      // Inline editing logic - Show for both new and existing groups
      btnSeparator.style.display = 'block';
      btnEdit.style.display = 'flex';

      const startEditing = (e) => {
        e.stopPropagation();
        if (btnContainer.classList.contains('editing')) {
           saveEdit();
           return;
        }
        btnContainer.classList.add('editing');
        groupNameInput.value = currentTitle;
        groupNameInput.focus();
        // Move cursor to the end instead of selecting all
        groupNameInput.setSelectionRange(currentTitle.length, currentTitle.length);
      };

      const saveEdit = () => {
        if (!btnContainer.classList.contains('editing')) return;
        const newTitle = groupNameInput.value.trim();
        if (newTitle !== '') {
          currentTitle = newTitle;
          setButtonTextState(currentTitle);
        }
        btnContainer.classList.remove('editing');
      };

      const cancelEdit = () => {
        if (!btnContainer.classList.contains('editing')) return;
        btnContainer.classList.remove('editing');
      };

      // Fix toggle: Prevent blur from firing when clicking the edit button
      btnEdit.addEventListener('mousedown', (e) => {
        // Only if we are already editing, we want to prevent blur so the click handler can toggle it off
        if (btnContainer.classList.contains('editing')) {
          e.preventDefault();
        }
      });

      btnEdit.addEventListener('click', startEditing);

      groupNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
      });

      groupNameInput.addEventListener('blur', saveEdit);

      container.appendChild(clone);
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Error loading suggestions</div>';
    badge.textContent = '0';
  }
}

// ============ Deduplication Rules ============
async function loadDeduplicationRules() {
  const listDomain = document.getElementById('domainDedupeRulesList');
  const listExact = document.getElementById('exactDedupeRulesList');
  const listPath = document.getElementById('pathDedupeRulesList');
  const badge = document.getElementById('deduplicationCount');

  try {
    const response = await browser.runtime.sendMessage({ type: 'getDeduplicationRules' });

    if (!response.success) {
      listDomain.innerHTML = '<div class="empty-state">Failed to load rules</div>';
      listExact.innerHTML = '<div class="empty-state">Failed to load rules</div>';
      listPath.innerHTML = '<div class="empty-state">Failed to load rules</div>';
      badge.textContent = '0';
      return;
    }

    const rules = response.rules || [];
    badge.textContent = rules.length;

    // Clear lists
    listDomain.innerHTML = '';
    listExact.innerHTML = '';
    listPath.innerHTML = '';

    const template = document.getElementById('dedupeRuleTemplate');

    let countDomain = 0;
    let countExact = 0;
    let countPath = 0;

    for (const rule of rules) {
      const clone = template.content.cloneNode(true);
      const item = clone.querySelector('.rule-item');

      if (!rule.enabled) item.classList.add('disabled');

      const urlSpan = clone.querySelector('.rule-pattern');
      urlSpan.textContent = rule.url;
      urlSpan.title = rule.url;

      // Hide the redundant match type span since we display rules in separate sections
      const matchTypeSpan = clone.querySelector('.rule-match-type');
      if (matchTypeSpan) {
        matchTypeSpan.style.display = 'none';
      }

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
          loadSuggestionsData();
        }
      });

      if (rule.matchType === 'domain') {
        listDomain.appendChild(clone);
        countDomain++;
      } else if (rule.matchType === 'exact') {
        listExact.appendChild(clone);
        countExact++;
      } else if (rule.matchType === 'path') {
        listPath.appendChild(clone);
        countPath++;
      }
    }

    if (countDomain === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent = 'No domain limits set.';
      listDomain.appendChild(emptyDiv);
    }
    if (countExact === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent = 'No specific page rules set.';
      listExact.appendChild(emptyDiv);
    }
    if (countPath === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent = 'No site-specific path rules set.';
      listPath.appendChild(emptyDiv);
    }
  } catch (e) {
    listDomain.textContent = '';
    listExact.textContent = '';
    listPath.textContent = '';
    
    const errDiv1 = document.createElement('div');
    errDiv1.className = 'empty-state';
    errDiv1.textContent = 'Error loading rules';
    listDomain.appendChild(errDiv1);

    const errDiv2 = document.createElement('div');
    errDiv2.className = 'empty-state';
    errDiv2.textContent = 'Error loading rules';
    listExact.appendChild(errDiv2);

    const errDiv3 = document.createElement('div');
    errDiv3.className = 'empty-state';
    errDiv3.textContent = 'Error loading rules';
    listPath.appendChild(errDiv3);

    badge.textContent = '0';
  }
}

function extractDomain(url) {
  try {
    let cleanUrl = url;
    if (url && !url.includes('://')) {
      cleanUrl = 'http://' + url;
    }
    const urlObj = new URL(cleanUrl);
    return urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

async function useCurrentTabDomainForInput(inputId) {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getCurrentTab' });
    if (response.success && response.tab && response.tab.url) {
      const domain = extractDomain(response.tab.url);
      if (domain) {
        document.getElementById(inputId).value = domain;
        showStatus('Current tab domain loaded', 'success');
      } else {
        showStatus('Could not extract domain', 'error');
      }
    } else {
      showStatus('Could not get current tab', 'error');
    }
  } catch (e) {
    showStatus('Failed to get current tab', 'error');
  }
}

async function useCurrentTabForExactDeduplication() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getCurrentTab' });
    if (response.success && response.tab && response.tab.url) {
      const urlInput = document.getElementById('exactDedupeUrl');
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

async function addDeduplicationRuleWithType(url, matchType, inputEl) {
  if (!url) {
    showStatus('Enter a URL or domain', 'error');
    return;
  }

  // Basic validation - check URL format for 'exact' rule type
  if (matchType === 'exact') {
    try {
      new URL(url);
    } catch (e) {
      showStatus('Invalid URL format (must start with http:// or https://)', 'error');
      return;
    }
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
      if (inputEl) inputEl.value = '';
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

function updatePathRulesSectionState() {
  const globalCheck = document.getElementById('preventDuplicateTabs');
  const section = document.getElementById('pathRulesSection');
  const statusEl = document.getElementById('pathDedupeStatus');
  const inputEl = document.getElementById('pathDedupeUrl');
  const buttonEl = document.getElementById('addPathDedupeBtn');

  if (globalCheck && section && statusEl && inputEl && buttonEl) {
    if (globalCheck.checked) {
      section.classList.add('disabled-section');
      statusEl.style.display = 'block';
      inputEl.disabled = true;
      buttonEl.disabled = true;
    } else {
      section.classList.remove('disabled-section');
      statusEl.style.display = 'none';
      inputEl.disabled = false;
      buttonEl.disabled = false;
    }
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

async function setupDeviceLayout() {
  try {
    const platform = await browser.runtime.getPlatformInfo();
    isAndroidDevice = platform.os === 'android';
    
    let isPopup = true;
    if (browser.extension && typeof browser.extension.getViews === 'function') {
      const popupViews = browser.extension.getViews({ type: 'popup' });
      isPopup = popupViews.includes(window);
    }
    
    if (isAndroidDevice) {
      document.body.classList.add('mobile-mode');
      document.body.classList.add('options-mode');
      const dedupeSection = document.getElementById('deduplicationSection');
      if (dedupeSection) {
        dedupeSection.classList.add('open');
      }
    } else if (!isPopup) {
      document.body.classList.add('options-mode');
    }
  } catch (err) {
    console.error('Failed to setup device layout:', err);
  }
}

// ============ Initialize ============
async function init() {
  await setupDeviceLayout();
  loadSettings();
  await loadSuggestionsData();

  // Setup comboboxes with the loaded data
  if (!isAndroidDevice) {
    setupCombobox('domainCombobox', 'rulePattern', 'domainDropdown', () => domainSuggestions);
    setupCombobox('groupCombobox', 'ruleGroup', 'groupDropdown', () => groupSuggestions);
  }
  setupCombobox('domainDedupeCombobox', 'domainDedupeUrl', 'domainDedupeDropdown', () => domainSuggestions);
  setupCombobox('exactDedupeCombobox', 'exactDedupeUrl', 'exactDedupeDropdown', () => urlSuggestions);
  setupCombobox('pathDedupeCombobox', 'pathDedupeUrl', 'pathDedupeDropdown', () => domainSuggestions);

  if (!isAndroidDevice) {
    loadRules();
    loadQuickGroupSuggestions();
  }
  loadDeduplicationRules();

  setupFeedbackLink();
  setupDonateLink();

  // Setup deduplication rule handlers
  document.getElementById('useCurrentTabDomainBtn').addEventListener('click', () => {
    useCurrentTabDomainForInput('domainDedupeUrl');
  });
  document.getElementById('addDomainDedupeBtn').addEventListener('click', () => {
    const urlInput = document.getElementById('domainDedupeUrl');
    addDeduplicationRuleWithType(urlInput.value.trim(), 'domain', urlInput);
  });
  document.getElementById('useCurrentTabExactBtn').addEventListener('click', useCurrentTabForExactDeduplication);
  document.getElementById('addExactDedupeBtn').addEventListener('click', () => {
    const urlInput = document.getElementById('exactDedupeUrl');
    addDeduplicationRuleWithType(urlInput.value.trim(), 'exact', urlInput);
  });
  document.getElementById('useCurrentTabPathBtn').addEventListener('click', () => {
    useCurrentTabDomainForInput('pathDedupeUrl');
  });
  document.getElementById('addPathDedupeBtn').addEventListener('click', () => {
    const urlInput = document.getElementById('pathDedupeUrl');
    addDeduplicationRuleWithType(urlInput.value.trim(), 'path', urlInput);
  });

  // Setup grouping rule handlers
  if (!isAndroidDevice) {
    document.getElementById('useCurrentTabForGroupingBtn').addEventListener('click', useCurrentTabForGrouping);
  }

  // Keypress event handlers for adding rules via Enter key
  document.getElementById('domainDedupeUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !document.getElementById('domainDedupeCombobox').classList.contains('open')) {
      const urlInput = document.getElementById('domainDedupeUrl');
      addDeduplicationRuleWithType(urlInput.value.trim(), 'domain', urlInput);
    }
  });
  document.getElementById('exactDedupeUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !document.getElementById('exactDedupeCombobox').classList.contains('open')) {
      const urlInput = document.getElementById('exactDedupeUrl');
      addDeduplicationRuleWithType(urlInput.value.trim(), 'exact', urlInput);
    }
  });
  document.getElementById('pathDedupeUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !document.getElementById('pathDedupeCombobox').classList.contains('open')) {
      const urlInput = document.getElementById('pathDedupeUrl');
      addDeduplicationRuleWithType(urlInput.value.trim(), 'path', urlInput);
    }
  });
}

init();

// Event listeners
if (!isAndroidDevice) {
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
}

document.getElementById('preventDuplicateTabs').addEventListener('change', () => {
  updateSkipDedupeWhenUserDuplicatedTabVisibility();
  updatePathRulesSectionState();
  saveSettings();
});
document.getElementById('closeOldTab').addEventListener('change', () => {
  updateCloseOldTabSuboptionVisibility();
  saveSettings();
});
if (!isAndroidDevice) {
  document.getElementById('preferGroupedTabWhenDuplicate').addEventListener('change', saveSettings);
}
document.getElementById('skipDedupeWhenUserDuplicatedTab').addEventListener('change', saveSettings);
document.getElementById('autoCloseDuplicates').addEventListener('change', () => {
  updateAutoCloseSuboptionVisibility();
  saveSettings();
});
document.getElementById('autoCloseDuplicatesInterval').addEventListener('change', saveSettings);
document.getElementById('sweepDuplicatesBtn').addEventListener('click', async () => {
  const btn = document.getElementById('sweepDuplicatesBtn');
  btn.disabled = true;
  try {
    const res = await browser.runtime.sendMessage({ type: 'sweepDuplicates' });
    if (res && res.success) {
      showStatus(res.closed ? `Closed ${res.closed} duplicate tab${res.closed > 1 ? 's' : ''}` : 'No duplicates found', 'success');
    } else {
      showStatus('Failed to clean up', 'error');
    }
  } catch (e) {
    showStatus('Failed to clean up', 'error');
  } finally {
    btn.disabled = false;
  }
});