/**
 * Wave - Popup Script
 * Handles UI interactions and communicates with background service worker
 */

// ============================================================================
// DOM Elements
// ============================================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elements = {
  // Panels
  panelIdle: $('#panel-idle'),
  panelRecording: $('#panel-recording'),
  panelPlaying: $('#panel-playing'),

  // Inputs & Buttons
  workflowName: $('#workflow-name'),
  btnStart: $('#btn-start'),
  btnStop: $('#btn-stop'),

  // Recording info
  recordingName: $('#recording-name'),
  stepCount: $('#step-count'),

  // Workflows
  workflowsList: $('#workflows-list'),
  workflowCount: $('#workflow-count'),
  emptyState: $('#empty-state'),

  // Import/Export
  btnImport: $('#btn-import'),
  btnExport: $('#btn-export'),
  importFile: $('#import-file'),
  btnToggleArchived: $('#btn-toggle-archived'),

  // Sort
  btnSort: $('#btn-sort'),
  sortMenu: $('#sort-menu')
};

// ============================================================================
// State
// ============================================================================

let state = {
  isRecording: false,
  isPlaying: false,
  currentWorkflow: null,
  workflows: [],
  showArchived: false,
  schedules: {},
  sortBy: 'recent' // 'recent', 'frequency', 'alphabetical'
};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  initTheme();
  await loadSortPreference();
  setupEventListeners();
  await refreshState();
  await loadWorkflows();
  await checkCurrentPage();

  // Poll for step count updates while recording
  setInterval(async () => {
    if (state.isRecording) {
      await refreshState();
    }
  }, 1000);
}

async function checkCurrentPage() {
  // This page (Wave extension) is always restricted, so we don't show warnings here
  // Users can use Alt+Shift+X from any target tab to record
}

// ============================================================================
// Theme
// ============================================================================

function initTheme() {
  // Load saved theme or default to dark
  chrome.storage.local.get('theme', (result) => {
    const theme = result.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  chrome.storage.local.set({ theme: newTheme });
}

// ============================================================================
// Sort Preferences
// ============================================================================

async function loadSortPreference() {
  const result = await chrome.storage.local.get('sortBy');
  state.sortBy = result.sortBy || 'recent';
  updateSortLabel();
}

async function saveSortPreference(sortBy) {
  state.sortBy = sortBy;
  await chrome.storage.local.set({ sortBy });
  updateSortLabel();
  renderWorkflows();
}

function updateSortLabel() {
  // Update active state in menu
  $$('.sort-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.sort === state.sortBy);
  });
}

function toggleSortMenu() {
  elements.sortMenu.classList.toggle('hidden');
}

function closeSortMenu() {
  elements.sortMenu.classList.add('hidden');
}

// ============================================================================
// State Management
// ============================================================================

async function refreshState() {
  try {
    const response = await sendMessage({ type: 'GET_STATE' });
    state.isRecording = response.isRecording;
    state.currentWorkflow = response.currentWorkflow;
    updateUI();
  } catch (err) {
    console.error('Failed to refresh state:', err);
  }
}

async function loadWorkflows() {
  try {
    const [workflows, schedules] = await Promise.all([
      sendMessage({ type: 'GET_WORKFLOWS' }),
      sendMessage({ type: 'GET_SCHEDULES' })
    ]);
    state.workflows = workflows || [];
    state.schedules = schedules || {};
    renderWorkflows();
  } catch (err) {
    console.error('Failed to load workflows:', err);
    state.workflows = [];
    state.schedules = {};
    renderWorkflows();
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
  elements.btnStart.addEventListener('click', handleStartRecording);
  elements.btnStop.addEventListener('click', handleStopRecording);

  // Enter key to start recording
  elements.workflowName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleStartRecording();
    }
  });

  // Import/Export
  elements.btnExport.addEventListener('click', handleExportWorkflows);
  elements.btnImport.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', handleImportWorkflows);

  // Toggle archived
  elements.btnToggleArchived.addEventListener('click', handleToggleArchived);

  // Theme toggle
  $('#btn-theme').addEventListener('click', toggleTheme);

  // Sort dropdown
  elements.btnSort.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSortMenu();
  });

  $$('.sort-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      saveSortPreference(opt.dataset.sort);
      closeSortMenu();
    });
  });

  // Close sort menu when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!elements.sortMenu.contains(e.target) && e.target !== elements.btnSort) {
      closeSortMenu();
    }
  });
}

// ============================================================================
// Recording Handlers
// ============================================================================

async function handleStartRecording() {
  const name = elements.workflowName.value.trim() || 'Untitled Workflow';

  try {
    setButtonLoading(elements.btnStart, true, 'Starting...');

    const response = await sendMessage({
      type: 'START_RECORDING',
      data: { name }
    });

    if (response.success) {
      state.isRecording = true;
      state.currentWorkflow = response.workflow;
      updateUI();
      const tabInfo = response.tabTitle ? ` on "${response.tabTitle}"` : '';
      showSuccess(`Recording started${tabInfo}!`);
    } else {
      // Check if error is about no valid tab
      if (response.error?.includes('No valid tab')) {
        showError('Open a website in another tab first');
      } else {
        showError('Failed to start: ' + (response.error || 'Unknown error'));
      }
    }
  } catch (err) {
    if (err.message?.includes('No valid tab')) {
      showError('Open a website in another tab first');
    } else {
      showError('Error: ' + err.message);
    }
  } finally {
    setButtonLoading(elements.btnStart, false);
  }
}

async function handleStopRecording() {
  try {
    setButtonLoading(elements.btnStop, true, 'Saving...');

    const response = await sendMessage({ type: 'STOP_RECORDING' });

    if (response.success) {
      state.isRecording = false;
      state.currentWorkflow = null;
      updateUI();
      await loadWorkflows();
    } else {
      showError('Failed to stop: ' + (response.error || 'Unknown error'));
    }
  } catch (err) {
    showError('Error: ' + err.message);
  } finally {
    setButtonLoading(elements.btnStop, false);
  }
}

// ============================================================================
// Workflow Actions
// ============================================================================

async function playWorkflow(workflowId) {
  const btn = $(`[data-play="${workflowId}"]`);

  try {
    if (btn) btn.disabled = true;
    state.isPlaying = true;
    updateUI();

    // Increment usage count before playing
    await incrementUsageCount(workflowId);

    const response = await sendMessage({
      type: 'PLAY_WORKFLOW',
      data: { workflowId }
    });

    if (response.success) {
      showSuccess('Workflow completed successfully!');
    } else {
      showError('Playback failed: ' + (response.error || 'Unknown error'));
    }
  } catch (err) {
    showError('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    state.isPlaying = false;
    updateUI();
  }
}

async function incrementUsageCount(workflowId) {
  try {
    const workflow = state.workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    const usageCount = (workflow.usageCount || 0) + 1;
    await sendMessage({
      type: 'SAVE_WORKFLOW',
      data: {
        ...workflow,
        usageCount,
        lastUsedAt: new Date().toISOString()
      }
    });

    // Update local state
    workflow.usageCount = usageCount;
    workflow.lastUsedAt = new Date().toISOString();
  } catch (err) {
    console.error('Failed to increment usage count:', err);
  }
}

async function deleteWorkflow(workflowId) {
  if (!confirm('Delete this workflow?')) return;

  try {
    const response = await sendMessage({
      type: 'DELETE_WORKFLOW',
      data: { id: workflowId }
    });

    if (response.success) {
      await loadWorkflows();
    } else {
      showError('Failed to delete');
    }
  } catch (err) {
    showError('Error: ' + err.message);
  }
}

async function archiveWorkflow(workflowId, archive = true) {
  try {
    const workflow = state.workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    const response = await sendMessage({
      type: 'SAVE_WORKFLOW',
      data: {
        ...workflow,
        status: archive ? 'archived' : 'active',
        updatedAt: new Date().toISOString()
      }
    });

    if (response.success) {
      await loadWorkflows();
      showSuccess(archive ? 'Workflow archived' : 'Workflow restored');
    }
  } catch (err) {
    showError('Error: ' + err.message);
  }
}

async function toggleSlowMode(workflowId, enabled) {
  try {
    const workflow = state.workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    const response = await sendMessage({
      type: 'SAVE_WORKFLOW',
      data: {
        ...workflow,
        slowMode: enabled
      }
    });

    if (response.success) {
      workflow.slowMode = enabled;
      showSuccess(enabled ? 'Slow mode enabled' : 'Slow mode disabled');
    }
  } catch (err) {
    showError('Error: ' + err.message);
  }
}

function handleToggleArchived() {
  state.showArchived = !state.showArchived;
  elements.btnToggleArchived.classList.toggle('active', state.showArchived);
  renderWorkflows();
}

// ============================================================================
// UI Updates
// ============================================================================

function updateUI() {
  // Hide all panels first
  elements.panelIdle.classList.add('hidden');
  elements.panelRecording.classList.add('hidden');
  elements.panelPlaying.classList.add('hidden');

  if (state.isPlaying) {
    elements.panelPlaying.classList.remove('hidden');
  } else if (state.isRecording) {
    elements.panelRecording.classList.remove('hidden');

    if (state.currentWorkflow) {
      elements.recordingName.textContent = state.currentWorkflow.name;
      const count = state.currentWorkflow.steps?.length || 0;
      elements.stepCount.textContent = `${count} step${count !== 1 ? 's' : ''}`;
    }
  } else {
    elements.panelIdle.classList.remove('hidden');
    elements.workflowName.value = '';
  }
}

function renderWorkflows() {
  // Filter workflows based on archived state
  let filteredWorkflows = state.workflows.filter(w => {
    const isArchived = w.status === 'archived';
    return state.showArchived ? isArchived : !isArchived;
  });

  // Sort workflows
  filteredWorkflows = sortWorkflows(filteredWorkflows);

  const totalCount = state.workflows.length;
  const activeCount = state.workflows.filter(w => w.status !== 'archived').length;
  const archivedCount = totalCount - activeCount;

  elements.workflowCount.textContent = state.showArchived ? archivedCount : activeCount;

  if (filteredWorkflows.length === 0) {
    elements.workflowsList.innerHTML = '';
    elements.emptyState.classList.remove('hidden');
    const mainText = elements.emptyState.querySelector('p:first-child');
    const hintText = elements.emptyState.querySelector('.empty-hint');
    if (state.showArchived) {
      if (mainText) mainText.textContent = 'No archived workflows';
      if (hintText) hintText.textContent = 'Archive workflows to see them here';
    } else {
      if (mainText) mainText.textContent = 'No workflows yet';
      if (hintText) hintText.textContent = 'Record your first workflow';
    }
    return;
  }

  elements.emptyState.classList.add('hidden');

  elements.workflowsList.innerHTML = filteredWorkflows
    .map(workflow => {
      const isArchived = workflow.status === 'archived';
      const schedule = state.schedules[workflow.id];
      const isScheduled = schedule && schedule.intervalMinutes > 0;
      const scheduleStatus = schedule?.lastStatus;
      const usageCount = workflow.usageCount || 0;

      const isSlowMode = workflow.slowMode || false;

      return `
      <div class="workflow-item ${isArchived ? 'archived' : ''}" data-id="${workflow.id}">
        <div class="workflow-info">
          <div class="workflow-name" data-edit-name="${workflow.id}" title="Click to edit name">
            ${escapeHtml(workflow.name)}
            ${isScheduled ? `<span class="schedule-badge ${scheduleStatus || ''}" title="${getScheduleTitle(schedule)}">&#9200;</span>` : ''}
          </div>
          <div class="workflow-meta">${workflow.steps.length} steps${usageCount > 0 ? ` · ${usageCount} runs` : ''} · ${formatDate(workflow.updatedAt)}</div>
        </div>
        <div class="workflow-actions">
          ${!isArchived ? `
          <label class="slow-mode-toggle" title="Slow mode (longer delays)">
            <input type="checkbox" data-slow-mode="${workflow.id}" ${isSlowMode ? 'checked' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </label>
          <button class="btn btn-success" data-play="${workflow.id}" title="Run">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          <button class="btn btn-ghost ${isScheduled ? 'active' : ''}" data-schedule="${workflow.id}" title="${isScheduled ? 'Edit schedule' : 'Schedule health check'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </button>
          <button class="btn btn-ghost" data-archive="${workflow.id}" data-is-archived="${isArchived}" title="Archive">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
            </svg>
          </button>
          ` : `
          <button class="btn btn-ghost" data-archive="${workflow.id}" data-is-archived="${isArchived}" title="Restore">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
            </svg>
          </button>
          <button class="btn btn-ghost danger" data-delete="${workflow.id}" title="Delete permanently">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
          `}
        </div>
      </div>
    `;})
    .join('');

  // Add event listeners
  $$('[data-play]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playWorkflow(btn.dataset.play);
    });
  });

  $$('[data-schedule]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showScheduleMenu(btn.dataset.schedule, btn);
    });
  });

  $$('[data-archive]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isArchived = btn.dataset.isArchived === 'true';
      archiveWorkflow(btn.dataset.archive, !isArchived);
    });
  });

  $$('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteWorkflow(btn.dataset.delete);
    });
  });

  $$('[data-edit-name]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditName(el.dataset.editName, el);
    });
  });

  $$('[data-slow-mode]').forEach(input => {
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleSlowMode(input.dataset.slowMode, input.checked);
    });
  });
}

function sortWorkflows(workflows) {
  switch (state.sortBy) {
    case 'frequency':
      return [...workflows].sort((a, b) => {
        const aCount = a.usageCount || 0;
        const bCount = b.usageCount || 0;
        if (bCount !== aCount) return bCount - aCount;
        // Tie-breaker: most recently used
        return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
      });

    case 'alphabetical':
      return [...workflows].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );

    case 'recent':
    default:
      return [...workflows].sort((a, b) =>
        new Date(b.updatedAt) - new Date(a.updatedAt)
      );
  }
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}

function startEditName(workflowId, element) {
  const workflow = state.workflows.find(w => w.id === workflowId);
  if (!workflow) return;

  // Get current name (without the schedule badge)
  const currentName = workflow.name;

  // Replace with input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input edit-name-input';
  input.value = currentName;

  const container = element.parentElement;
  element.style.display = 'none';
  container.insertBefore(input, element);

  input.focus();
  input.select();

  const saveEdit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      await renameWorkflow(workflowId, newName);
    } else {
      // Restore original
      input.remove();
      element.style.display = '';
    }
  };

  input.addEventListener('blur', saveEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = currentName; // Reset to original
      input.blur();
    }
  });
}

async function renameWorkflow(workflowId, newName) {
  try {
    const workflow = state.workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    const response = await sendMessage({
      type: 'SAVE_WORKFLOW',
      data: {
        ...workflow,
        name: newName,
        updatedAt: new Date().toISOString()
      }
    });

    if (response.success) {
      await loadWorkflows();
      showSuccess('Workflow renamed');
    }
  } catch (err) {
    showError('Failed to rename: ' + err.message);
    await loadWorkflows(); // Refresh to restore UI
  }
}

function getScheduleTitle(schedule) {
  if (!schedule) return '';
  let title = `Every ${schedule.intervalMinutes} min`;
  if (schedule.lastRun) {
    const ago = getTimeAgo(new Date(schedule.lastRun));
    title += `\nLast run: ${ago}`;
    if (schedule.lastStatus === 'failed') {
      title += ` (failed: ${schedule.lastError || 'unknown'})`;
    }
  }
  return title;
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function showScheduleMenu(workflowId, btn) {
  // Remove existing menu
  const existingMenu = document.querySelector('.schedule-menu');
  if (existingMenu) existingMenu.remove();

  const schedule = state.schedules[workflowId];
  const currentInterval = schedule?.intervalMinutes || 0;

  const menu = document.createElement('div');
  menu.className = 'schedule-menu';
  menu.innerHTML = `
    <div class="schedule-menu-title">Health Check Schedule</div>
    <div class="schedule-options">
      <button class="schedule-option ${currentInterval === 0 ? 'active' : ''}" data-interval="0">Off</button>
      <button class="schedule-option ${currentInterval === 30 ? 'active' : ''}" data-interval="30">30 min</button>
      <button class="schedule-option ${currentInterval === 60 ? 'active' : ''}" data-interval="60">1 hour</button>
      <button class="schedule-option ${currentInterval === 360 ? 'active' : ''}" data-interval="360">6 hours</button>
      <button class="schedule-option ${currentInterval === 720 ? 'active' : ''}" data-interval="720">12 hours</button>
      <button class="schedule-option ${currentInterval === 1440 ? 'active' : ''}" data-interval="1440">Daily</button>
    </div>
    ${schedule?.lastRun ? `
    <div class="schedule-status">
      Last: ${getTimeAgo(new Date(schedule.lastRun))}
      <span class="status-dot ${schedule.lastStatus}"></span>
    </div>
    ` : ''}
  `;

  // Position menu
  const rect = btn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${document.body.clientWidth - rect.right}px`;

  document.body.appendChild(menu);

  // Handle clicks
  menu.querySelectorAll('[data-interval]').forEach(option => {
    option.addEventListener('click', async () => {
      const interval = parseInt(option.dataset.interval);
      await setSchedule(workflowId, interval);
      menu.remove();
    });
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

async function setSchedule(workflowId, intervalMinutes) {
  try {
    const response = await sendMessage({
      type: 'SCHEDULE_WORKFLOW',
      data: { workflowId, intervalMinutes }
    });

    if (response.success) {
      await loadWorkflows();
      if (intervalMinutes > 0) {
        showSuccess(`Scheduled every ${intervalMinutes} min`);
      } else {
        showSuccess('Schedule removed');
      }
    }
  } catch (err) {
    showError('Failed to set schedule: ' + err.message);
  }
}

// ============================================================================
// Import/Export
// ============================================================================

async function handleExportWorkflows() {
  if (state.workflows.length === 0) {
    showError('No workflows to export');
    return;
  }

  try {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      workflows: state.workflows
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `wave-workflows-${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showSuccess(`Exported ${state.workflows.length} workflow(s)`);
  } catch (err) {
    showError('Export failed: ' + err.message);
  }
}

async function handleImportWorkflows(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Validate structure
    if (!data.workflows || !Array.isArray(data.workflows)) {
      throw new Error('Invalid file format');
    }

    // Validate each workflow
    const validWorkflows = data.workflows.filter(w =>
      w.id && w.name && Array.isArray(w.steps)
    );

    if (validWorkflows.length === 0) {
      throw new Error('No valid workflows found in file');
    }

    // Import workflows (merge with existing, update if same ID)
    let imported = 0;
    let updated = 0;

    for (const workflow of validWorkflows) {
      const existing = state.workflows.find(w => w.id === workflow.id);
      if (existing) {
        updated++;
      } else {
        imported++;
      }

      await sendMessage({
        type: 'SAVE_WORKFLOW',
        data: {
          ...workflow,
          updatedAt: new Date().toISOString()
        }
      });
    }

    await loadWorkflows();

    const msg = [];
    if (imported > 0) msg.push(`${imported} imported`);
    if (updated > 0) msg.push(`${updated} updated`);
    showSuccess(`Workflows: ${msg.join(', ')}`);

  } catch (err) {
    if (err instanceof SyntaxError) {
      showError('Invalid JSON file');
    } else {
      showError('Import failed: ' + err.message);
    }
  }

  // Reset file input
  event.target.value = '';
}

// ============================================================================
// Utilities
// ============================================================================

function sendMessage(message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timed out. Please try again.'));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, response => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
          // Provide user-friendly error messages
          if (errorMsg.includes('Receiving end does not exist')) {
            reject(new Error('Extension is reloading. Please try again.'));
          } else if (errorMsg.includes('Extension context invalidated')) {
            reject(new Error('Extension was updated. Please refresh this popup.'));
          } else if (errorMsg.includes('chrome://')) {
            reject(new Error('Cannot record on browser pages. Navigate to a website first.'));
          } else {
            reject(new Error(errorMsg));
          }
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(new Error('Failed to communicate with extension. Please reload.'));
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setButtonLoading(btn, loading, text = '') {
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = text || 'Loading...';
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText) {
      btn.innerHTML = btn.dataset.originalText;
    }
  }
}

function showError(message) {
  // Remove existing toast if any
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8v4M12 16h.01"/>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  // Auto remove after 5s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function showSuccess(message) {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = 'toast toast-success';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 6L9 17l-5-5"/>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
