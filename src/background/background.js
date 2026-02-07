/**
 * Wave - Background Service Worker
 * Manages state, storage, and coordinates between popup and content scripts
 */

// ============================================================================
// State
// ============================================================================

let isRecording = false;
let currentWorkflow = null;
let recordingTabId = null;

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Wave Background] Message received:', message.type);

  switch (message.type) {
    case 'START_RECORDING':
      handleStartRecording(message.data, sender.tab?.id)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Async response

    case 'STOP_RECORDING':
      handleStopRecording()
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'RECORD_STEP':
      handleRecordStep(message.data, sender.tab?.id);
      sendResponse({ success: true });
      break;

    case 'GET_STATE':
      sendResponse({
        isRecording,
        currentWorkflow,
        recordingTabId
      });
      break;

    case 'PLAY_WORKFLOW':
      handlePlayWorkflow(message.data)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_WORKFLOWS':
      getWorkflows()
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SAVE_WORKFLOW':
      saveWorkflow(message.data)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'DELETE_WORKFLOW':
      deleteWorkflow(message.data.id)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SCHEDULE_WORKFLOW':
      scheduleWorkflow(message.data.workflowId, message.data.intervalMinutes)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_SCHEDULES':
      getSchedules()
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'RUN_HEALTH_CHECK':
      runHealthCheck(message.data.workflowId)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      console.warn('[Wave Background] Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// ============================================================================
// Recording
// ============================================================================

async function handleStartRecording(data, tabId) {
  if (isRecording) {
    throw new Error('Already recording');
  }

  const { name, url } = data;

  // Get current tab if no tabId
  let tab;
  if (!tabId) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
  } else {
    tab = await chrome.tabs.get(tabId);
  }

  // Check if URL is accessible
  const tabUrl = tab.url || '';
  if (isRestrictedUrl(tabUrl)) {
    // If we're on Wave's own page or another restricted page, find another valid tab
    const validTab = await findValidTab(tab.windowId, tabId);
    if (validTab) {
      tab = validTab;
      tabId = validTab.id;
      console.log('[Wave Background] Switched to valid tab:', tabUrl, '->', tab.url);
    } else {
      throw new Error('No valid tab found. Open a website in another tab first.');
    }
  }

  // Inject content script if not already present
  await ensureContentScript(tabId);

  // Create new workflow
  currentWorkflow = {
    id: generateId(),
    name: name || 'Untitled Workflow',
    steps: [],
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Add initial navigation step if URL provided
  if (url) {
    currentWorkflow.steps.push({
      type: 'navigate',
      value: url,
      timestamp: Date.now()
    });
    await chrome.tabs.update(tabId, { url });
  }

  isRecording = true;
  recordingTabId = tabId;

  // Focus the recording tab so user sees where they're recording
  await chrome.tabs.update(tabId, { active: true });

  // Notify content script to start recording
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' });
  } catch (e) {
    // Content script might not be ready yet, retry after a short delay
    await sleep(100);
    await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED' });
  }

  // Update badge
  await chrome.action.setBadgeText({ text: 'REC' });
  await chrome.action.setBadgeBackgroundColor({ color: '#e53935' });

  console.log('[Wave Background] Recording started:', currentWorkflow.id, 'on tab:', tab.title);

  return { success: true, workflow: currentWorkflow, tabTitle: tab.title };
}

async function ensureContentScript(tabId) {
  try {
    // Try to ping the content script
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (response?.pong) {
      return true;
    }
  } catch (e) {
    // Content script not loaded, inject it
  }

  try {
    console.log('[Wave Background] Injecting content script into tab', tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/content.js']
    });
    // Wait for script to initialize
    await sleep(150);
    return true;
  } catch (err) {
    console.error('[Wave Background] Failed to inject content script:', err.message);
    throw new Error('Cannot access this page. Please navigate to a regular website.');
  }
}

async function handleStopRecording() {
  if (!isRecording) {
    throw new Error('Not recording');
  }

  // Notify content script
  if (recordingTabId) {
    try {
      await chrome.tabs.sendMessage(recordingTabId, { type: 'RECORDING_STOPPED' });
    } catch (e) {
      // Tab might be closed
    }
  }

  // Save workflow
  currentWorkflow.updatedAt = new Date().toISOString();
  await saveWorkflow(currentWorkflow);

  const savedWorkflow = currentWorkflow;

  // Reset state
  isRecording = false;
  currentWorkflow = null;
  recordingTabId = null;

  // Clear badge
  await chrome.action.setBadgeText({ text: '' });

  console.log('[Wave Background] Recording stopped:', savedWorkflow.id);

  return { success: true, workflow: savedWorkflow };
}

function handleRecordStep(step, tabId) {
  if (!isRecording || !currentWorkflow) {
    console.warn('[Wave Background] Received step but not recording');
    return;
  }

  // Only record from the recording tab
  if (tabId !== recordingTabId) {
    return;
  }

  currentWorkflow.steps.push({
    ...step,
    timestamp: Date.now()
  });

  console.log('[Wave Background] Step recorded:', step.type, currentWorkflow.steps.length);
}

// ============================================================================
// Playback
// ============================================================================

async function handlePlayWorkflow(data) {
  const { workflowId } = data;

  const workflows = await getWorkflows();
  const workflow = workflows.find(w => w.id === workflowId);

  if (!workflow) {
    throw new Error('Workflow not found');
  }

  if (!workflow.steps || workflow.steps.length === 0) {
    throw new Error('Workflow has no steps to play');
  }

  console.log('[Wave Background] Playing workflow:', workflow.name);

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentTabId = tab.id;

  // Check if we can access the current tab
  if (isRestrictedUrl(tab.url) && workflow.steps[0]?.type !== 'navigate') {
    throw new Error('Cannot play on this page. The workflow should start with a navigate step, or navigate to a regular website first.');
  }

  // Determine delay between steps
  const stepDelay = workflow.slowMode ? 1500 : 300;

  // Execute each step
  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    console.log(`[Wave Background] Executing step ${i + 1}/${workflow.steps.length}:`, step.type);

    try {
      await executeStep(currentTabId, step);
      // Delay between steps (longer if slowMode)
      await sleep(stepDelay);
    } catch (err) {
      console.error('[Wave Background] Step failed:', err);
      return { success: false, error: `Step ${i + 1} failed: ${err.message}`, stepIndex: i };
    }
  }

  return { success: true };
}

async function executeStep(tabId, step) {
  switch (step.type) {
    case 'navigate':
      // Check if URL is valid
      if (!step.value || !isValidUrl(step.value)) {
        throw new Error(`Invalid URL: ${step.value}`);
      }
      await chrome.tabs.update(tabId, { url: step.value });
      // Wait for page load
      await waitForTabLoad(tabId);
      // Inject content script after navigation
      await ensureContentScript(tabId);
      break;

    case 'click':
    case 'input':
      // Ensure content script is loaded
      await ensureContentScript(tabId);
      // Send to content script with timeout
      try {
        const response = await Promise.race([
          chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_STEP', step }),
          sleep(15000).then(() => ({ success: false, error: 'Step timed out after 15s' }))
        ]);
        if (!response?.success) {
          throw new Error(response?.error || 'Step execution failed');
        }
      } catch (err) {
        if (err.message?.includes('Receiving end does not exist')) {
          // Try re-injecting content script and retry once
          await ensureContentScript(tabId);
          await sleep(200);
          const retryResponse = await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_STEP', step });
          if (!retryResponse?.success) {
            throw new Error(retryResponse?.error || 'Step execution failed after retry');
          }
        } else {
          throw err;
        }
      }
      break;

    case 'wait':
      // Simple wait step
      const waitTime = parseInt(step.value) || 1000;
      await sleep(Math.min(waitTime, 30000)); // Max 30s wait
      break;

    default:
      console.warn('[Wave Background] Unknown step type:', step.type);
  }
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra delay for JS to initialize
        setTimeout(resolve, 500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 30s
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });
}

// ============================================================================
// Storage
// ============================================================================

async function getWorkflows() {
  const result = await chrome.storage.local.get('workflows');
  return result.workflows || [];
}

async function saveWorkflow(workflow) {
  const workflows = await getWorkflows();
  const index = workflows.findIndex(w => w.id === workflow.id);

  if (index >= 0) {
    workflows[index] = workflow;
  } else {
    workflows.push(workflow);
  }

  await chrome.storage.local.set({ workflows });
  return { success: true, workflow };
}

async function deleteWorkflow(id) {
  const workflows = await getWorkflows();
  const filtered = workflows.filter(w => w.id !== id);
  await chrome.storage.local.set({ workflows: filtered });
  return { success: true };
}

// ============================================================================
// Utilities
// ============================================================================

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRestrictedUrl(url) {
  if (!url) return true;
  const restricted = [
    'chrome://',
    'chrome-extension://',
    'about:',
    'edge://',
    'brave://',
    'opera://',
    'vivaldi://',
    'firefox:',
    'moz-extension://',
    'devtools://',
    'view-source:',
    'data:',
    'javascript:'
  ];
  return restricted.some(prefix => url.toLowerCase().startsWith(prefix));
}

async function findValidTab(windowId, excludeTabId) {
  // Find all tabs in the same window
  const tabs = await chrome.tabs.query({ windowId });

  // Filter to valid tabs (not restricted, not the excluded tab)
  const validTabs = tabs.filter(t =>
    t.id !== excludeTabId &&
    !isRestrictedUrl(t.url) &&
    t.url // has a URL
  );

  if (validTabs.length === 0) {
    return null;
  }

  // Prefer the most recently accessed tab
  // Sort by lastAccessed if available, otherwise by index
  validTabs.sort((a, b) => {
    if (a.lastAccessed && b.lastAccessed) {
      return b.lastAccessed - a.lastAccessed;
    }
    return b.index - a.index;
  });

  return validTabs[0];
}

// ============================================================================
// Health Checks (Scheduled Workflows)
// ============================================================================

async function getSchedules() {
  const result = await chrome.storage.local.get('schedules');
  return result.schedules || {};
}

async function saveSchedule(workflowId, schedule) {
  const schedules = await getSchedules();
  if (schedule) {
    schedules[workflowId] = schedule;
  } else {
    delete schedules[workflowId];
  }
  await chrome.storage.local.set({ schedules });
  return { success: true };
}

async function scheduleWorkflow(workflowId, intervalMinutes) {
  const alarmName = `wave-healthcheck-${workflowId}`;

  if (intervalMinutes <= 0) {
    // Remove schedule
    await chrome.alarms.clear(alarmName);
    await saveSchedule(workflowId, null);
    console.log('[Wave Background] Schedule removed for workflow:', workflowId);
    return { success: true, scheduled: false };
  }

  // Create alarm
  await chrome.alarms.create(alarmName, {
    delayInMinutes: intervalMinutes,
    periodInMinutes: intervalMinutes
  });

  // Save schedule info
  await saveSchedule(workflowId, {
    intervalMinutes,
    createdAt: new Date().toISOString(),
    lastRun: null,
    lastStatus: null
  });

  console.log('[Wave Background] Scheduled workflow:', workflowId, 'every', intervalMinutes, 'minutes');
  return { success: true, scheduled: true, intervalMinutes };
}

async function runHealthCheck(workflowId) {
  console.log('[Wave Background] Running health check for:', workflowId);

  const workflows = await getWorkflows();
  const workflow = workflows.find(w => w.id === workflowId);

  if (!workflow) {
    console.warn('[Wave Background] Health check: workflow not found');
    return { success: false, error: 'Workflow not found' };
  }

  // Create a new tab for the health check
  let tab;
  try {
    tab = await chrome.tabs.create({ active: false, url: 'about:blank' });

    // Execute each step
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      await executeStep(tab.id, step);
      await sleep(300);
    }

    // Update schedule status
    const schedules = await getSchedules();
    if (schedules[workflowId]) {
      schedules[workflowId].lastRun = new Date().toISOString();
      schedules[workflowId].lastStatus = 'success';
      await chrome.storage.local.set({ schedules });
    }

    // Close tab
    await chrome.tabs.remove(tab.id);

    console.log('[Wave Background] Health check passed:', workflow.name);
    return { success: true };

  } catch (err) {
    console.error('[Wave Background] Health check failed:', err);

    // Update schedule status
    const schedules = await getSchedules();
    if (schedules[workflowId]) {
      schedules[workflowId].lastRun = new Date().toISOString();
      schedules[workflowId].lastStatus = 'failed';
      schedules[workflowId].lastError = err.message;
      await chrome.storage.local.set({ schedules });
    }

    // Show notification
    try {
      await chrome.notifications.create(`wave-failure-${workflowId}`, {
        type: 'basic',
        iconUrl: 'icons/wave-128.png',
        title: 'Wave Health Check Failed',
        message: `${workflow.name}: ${err.message}`,
        priority: 2
      });
    } catch (notifErr) {
      console.warn('[Wave Background] Could not show notification:', notifErr);
    }

    // Close tab if it exists
    if (tab) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {}
    }

    return { success: false, error: err.message };
  }
}

// Listen for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('wave-healthcheck-')) {
    const workflowId = alarm.name.replace('wave-healthcheck-', '');
    await runHealthCheck(workflowId);
  }
});

// ============================================================================
// Lifecycle
// ============================================================================

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Wave] Extension installed');

  // Re-register alarms on install/update
  const schedules = await getSchedules();
  for (const [workflowId, schedule] of Object.entries(schedules)) {
    if (schedule && schedule.intervalMinutes > 0) {
      const alarmName = `wave-healthcheck-${workflowId}`;
      await chrome.alarms.create(alarmName, {
        delayInMinutes: schedule.intervalMinutes,
        periodInMinutes: schedule.intervalMinutes
      });
      console.log('[Wave Background] Re-registered alarm for:', workflowId);
    }
  }
});

console.log('[Wave] Background service worker started');
