/**
 * Wave - Content Script
 * Runs in web pages to record user interactions and execute playback steps
 */

// ============================================================================
// State
// ============================================================================

let isRecording = false;

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Wave Content] Message received:', message.type);

  try {
    switch (message.type) {
      case 'PING':
        sendResponse({ success: true, pong: true });
        break;

      case 'RECORDING_STARTED':
        startRecording();
        sendResponse({ success: true });
        break;

      case 'RECORDING_STOPPED':
        stopRecording();
        sendResponse({ success: true });
        break;

      case 'EXECUTE_STEP':
        executeStep(message.step)
          .then(() => sendResponse({ success: true }))
          .catch(err => {
            console.error('[Wave Content] Step execution failed:', err);
            sendResponse({ success: false, error: err.message || 'Unknown error' });
          });
        return true; // Async response

      case 'GET_PAGE_INFO':
        sendResponse({
          success: true,
          url: window.location.href,
          title: document.title
        });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (err) {
    console.error('[Wave Content] Message handler error:', err);
    sendResponse({ success: false, error: err.message || 'Unknown error' });
  }
});

// ============================================================================
// Recording
// ============================================================================

function startRecording() {
  if (isRecording) return;

  isRecording = true;
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);

  // Visual indicator
  showRecordingIndicator();

  console.log('[Wave Content] Recording started');
}

function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('change', handleChange, true);

  // Remove visual indicator
  hideRecordingIndicator();

  console.log('[Wave Content] Recording stopped');
}

// ============================================================================
// Event Handlers
// ============================================================================

function handleClick(event) {
  if (!isRecording) return;

  const target = event.target;

  // Skip Wave's own UI elements
  if (target.closest('#wave-recording-indicator')) return;

  const selector = generateSelector(target);
  if (!selector) return;

  const step = {
    type: 'click',
    selector,
    value: null,
    tagName: target.tagName.toLowerCase(),
    text: target.textContent?.trim().substring(0, 50) || null
  };

  sendStep(step);
  console.log('[Wave Content] Click recorded:', selector);
}

function handleInput(event) {
  if (!isRecording) return;

  const target = event.target;
  if (!isInputElement(target)) return;

  // Debounce input events
  clearTimeout(target._waveInputTimeout);
  target._waveInputTimeout = setTimeout(() => {
    const selector = generateSelector(target);
    if (!selector) return;

    const step = {
      type: 'input',
      selector,
      value: target.value,
      tagName: target.tagName.toLowerCase(),
      inputType: target.type || 'text'
    };

    sendStep(step);
    console.log('[Wave Content] Input recorded:', selector);
  }, 500);
}

function handleChange(event) {
  if (!isRecording) return;

  const target = event.target;

  // Handle select elements
  if (target.tagName === 'SELECT') {
    const selector = generateSelector(target);
    if (!selector) return;

    const step = {
      type: 'input',
      selector,
      value: target.value,
      tagName: 'select'
    };

    sendStep(step);
    console.log('[Wave Content] Select recorded:', selector);
  }
}

function isInputElement(el) {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

// ============================================================================
// Selector Generation
// ============================================================================

function generateSelector(element) {
  // Priority 1: ID (if unique and stable-looking)
  if (element.id && isStableId(element.id)) {
    return `#${CSS.escape(element.id)}`;
  }

  // Priority 2: data-testid or similar
  const testId = element.getAttribute('data-testid') ||
                 element.getAttribute('data-test-id') ||
                 element.getAttribute('data-cy');
  if (testId) {
    return `[data-testid="${testId}"], [data-test-id="${testId}"], [data-cy="${testId}"]`;
  }

  // Priority 3: name attribute (for form elements)
  if (element.name && (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA')) {
    return `${element.tagName.toLowerCase()}[name="${element.name}"]`;
  }

  // Priority 4: Unique class combination
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.trim().split(/\s+/).filter(c => isStableClass(c));
    if (classes.length > 0) {
      const selector = `${element.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // Priority 5: aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const selector = `${element.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Priority 6: CSS path (fallback)
  return getCssPath(element);
}

function isStableId(id) {
  // Reject IDs that look auto-generated
  if (/^[a-f0-9-]{36}$/i.test(id)) return false; // UUID
  if (/^:r[a-z0-9]+:$/i.test(id)) return false; // React generated
  if (/^\d+$/.test(id)) return false; // Pure numbers
  if (id.length > 50) return false; // Too long
  return true;
}

function isStableClass(cls) {
  // Reject classes that look auto-generated or dynamic
  if (/^[a-z]{1,3}-[a-f0-9]{4,}$/i.test(cls)) return false; // CSS modules hash
  if (/^css-[a-z0-9]+$/i.test(cls)) return false; // Emotion/styled
  if (/^sc-[a-zA-Z]+$/i.test(cls)) return false; // Styled components
  if (cls.length > 30) return false;
  return true;
}

function getCssPath(element) {
  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();

    if (current.id && isStableId(current.id)) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // Add nth-child for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = parent;

    // Limit path depth
    if (path.length > 5) break;
  }

  return path.join(' > ');
}

// ============================================================================
// Step Execution (Playback)
// ============================================================================

async function executeStep(step) {
  const element = await waitForElement(step.selector);

  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  switch (step.type) {
    case 'click':
      // Scroll into view
      try {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        // Some elements can't be scrolled
      }
      await sleep(200);

      // Highlight briefly
      highlightElement(element);

      // Try multiple click methods for compatibility
      try {
        // First try native click
        element.click();
      } catch (e) {
        // Fallback to dispatching click event
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(clickEvent);
      }
      break;

    case 'input':
      try {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {}
      await sleep(200);

      highlightElement(element);

      // Focus the element
      try {
        element.focus();
      } catch (e) {}

      // Handle different input types
      if (element.tagName === 'SELECT') {
        element.value = step.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (element.isContentEditable) {
        element.textContent = step.value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: step.value }));
      } else {
        // Regular input/textarea
        // Use native value setter for better React/Vue compatibility
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(element, step.value);
        } else {
          element.value = step.value;
        }

        // Dispatch events for frameworks
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }
      break;

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

async function waitForElement(selector, timeout = 10000) {
  const start = Date.now();
  const selectors = selector.split(',').map(s => s.trim());

  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        // Try exact match first
        const element = document.querySelector(sel);
        if (element && isVisible(element)) {
          return element;
        }

        // If not found and selector looks like it might have changed structure,
        // try finding by text content for buttons/links
        if (!element && sel.includes('[') && sel.includes('=')) {
          // This is an attribute selector, skip text search
          continue;
        }
      } catch (e) {
        // Invalid selector - try recovering
        console.warn('[Wave Content] Invalid selector:', sel, e.message);
      }
    }

    // Wait before next attempt
    await sleep(100);
  }

  // Log what we couldn't find for debugging
  console.warn('[Wave Content] Element not found after timeout:', selector);
  return null;
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0' &&
         element.offsetParent !== null;
}

function highlightElement(element) {
  const originalOutline = element.style.outline;
  element.style.outline = '3px solid #4CAF50';
  setTimeout(() => {
    element.style.outline = originalOutline;
  }, 500);
}

// ============================================================================
// Communication
// ============================================================================

function sendStep(step) {
  chrome.runtime.sendMessage({
    type: 'RECORD_STEP',
    data: step
  });
}

// ============================================================================
// Visual Indicator
// ============================================================================

function showRecordingIndicator() {
  if (!document.body) return;
  if (document.getElementById('wave-recording-indicator')) return;

  const indicator = document.createElement('div');
  indicator.id = 'wave-recording-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      padding: 10px 18px;
      border-radius: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 20px rgba(239, 68, 68, 0.4);
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: default;
      user-select: none;
      backdrop-filter: blur(8px);
      pointer-events: none;
    ">
      <span style="
        width: 10px;
        height: 10px;
        background: white;
        border-radius: 50%;
        animation: wave-pulse 1.5s ease-in-out infinite;
        box-shadow: 0 0 8px rgba(255,255,255,0.6);
      "></span>
      <span>Recording</span>
    </div>
    <style>
      @keyframes wave-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(0.9); }
      }
    </style>
  `;

  try {
    document.body.appendChild(indicator);
  } catch (e) {
    console.warn('[Wave Content] Could not show recording indicator:', e);
  }
}

function hideRecordingIndicator() {
  try {
    const indicator = document.getElementById('wave-recording-indicator');
    if (indicator) {
      indicator.remove();
    }
  } catch (e) {
    // Ignore removal errors
  }
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Init
// ============================================================================

console.log('[Wave Content] Content script loaded');
