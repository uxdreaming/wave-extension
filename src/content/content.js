/**
 * Wave - Content Script
 * Runs in web pages to record user interactions and execute playback steps
 */

// ============================================================================
// State
// ============================================================================

let isRecording = false;
let shadowObserver = null;
let attachedShadowRoots = new WeakSet();

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

  // Use window-level listener with capture to catch events before any framework
  window.addEventListener('click', handleClick, true);
  window.addEventListener('input', handleInput, true);
  window.addEventListener('change', handleChange, true);

  // Also add listeners to document for backup
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);

  // Observe and attach to Shadow DOMs (for YouTube, etc.)
  observeShadowRoots();

  // Visual indicator
  showRecordingIndicator();

  console.log('[Wave Content] Recording started');
}

function stopRecording() {
  if (!isRecording) return;

  isRecording = false;

  // Remove window listeners
  window.removeEventListener('click', handleClick, true);
  window.removeEventListener('input', handleInput, true);
  window.removeEventListener('change', handleChange, true);

  // Remove document listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('change', handleChange, true);

  // Stop shadow DOM observer
  if (shadowObserver) {
    shadowObserver.disconnect();
    shadowObserver = null;
  }

  // Remove visual indicator
  hideRecordingIndicator();

  console.log('[Wave Content] Recording stopped');
}

// ============================================================================
// Shadow DOM Support
// ============================================================================

function observeShadowRoots() {
  // Attach to existing shadow roots
  attachToShadowRoots(document.body);

  // Watch for new elements with shadow roots
  shadowObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          attachToShadowRoots(node);
        }
      }
    }
  });

  shadowObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function attachToShadowRoots(root) {
  if (!root) return;

  // Check if this element has a shadow root
  if (root.shadowRoot && !attachedShadowRoots.has(root.shadowRoot)) {
    attachedShadowRoots.add(root.shadowRoot);
    root.shadowRoot.addEventListener('click', handleClick, true);
    root.shadowRoot.addEventListener('input', handleInput, true);
    root.shadowRoot.addEventListener('change', handleChange, true);
    console.log('[Wave Content] Attached to shadow root:', root.tagName);

    // Recursively check inside shadow root
    attachToShadowRoots(root.shadowRoot);
  }

  // Check all child elements
  const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const el of elements) {
    if (el.shadowRoot && !attachedShadowRoots.has(el.shadowRoot)) {
      attachedShadowRoots.add(el.shadowRoot);
      el.shadowRoot.addEventListener('click', handleClick, true);
      el.shadowRoot.addEventListener('input', handleInput, true);
      el.shadowRoot.addEventListener('change', handleChange, true);
      console.log('[Wave Content] Attached to shadow root:', el.tagName);

      // Recursively check inside shadow root
      attachToShadowRoots(el.shadowRoot);
    }
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

function handleClick(event) {
  if (!isRecording) return;

  let target = event.target;

  // Skip Wave's own UI elements
  if (target.closest('#wave-recording-indicator')) return;

  // Find the actual clickable element (button, link) instead of inner spans/divs
  target = getClickableElement(target);

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

function getClickableElement(element) {
  // If already a clickable element, return it
  const clickableTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
  if (clickableTags.includes(element.tagName)) {
    return element;
  }

  // Check for role="button" or role="link"
  if (element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link') {
    return element;
  }

  // Check for onclick attribute
  if (element.hasAttribute('onclick')) {
    return element;
  }

  // Look for closest clickable parent (up to 5 levels)
  let parent = element.parentElement;
  let depth = 0;
  while (parent && depth < 5) {
    if (clickableTags.includes(parent.tagName)) {
      return parent;
    }
    if (parent.getAttribute('role') === 'button' || parent.getAttribute('role') === 'link') {
      return parent;
    }
    if (parent.hasAttribute('onclick')) {
      return parent;
    }
    // Check for cursor pointer style (indicates clickable)
    const style = window.getComputedStyle(parent);
    if (style.cursor === 'pointer' && (parent.tagName === 'DIV' || parent.tagName === 'SPAN' || parent.tagName === 'LI')) {
      // Make sure it's a reasonable target (has some identifying features)
      if (parent.id || parent.className || parent.getAttribute('data-testid')) {
        return parent;
      }
    }
    parent = parent.parentElement;
    depth++;
  }

  // No clickable parent found, return original
  return element;
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
                 element.getAttribute('data-cy') ||
                 element.getAttribute('data-id');
  if (testId) {
    const attr = element.getAttribute('data-testid') ? 'data-testid' :
                 element.getAttribute('data-test-id') ? 'data-test-id' :
                 element.getAttribute('data-cy') ? 'data-cy' : 'data-id';
    return `[${attr}="${CSS.escape(testId)}"]`;
  }

  // Priority 3: name attribute (for form elements)
  if (element.name && (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA')) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
  }

  // Priority 4: Links with href
  if (element.tagName === 'A' && element.getAttribute('href')) {
    const href = element.getAttribute('href');
    // Only use href if it's not just "#" or "javascript:"
    if (href && href !== '#' && !href.startsWith('javascript:')) {
      const selector = `a[href="${CSS.escape(href)}"]`;
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
      // Try with partial href match for dynamic URLs
      const pathname = new URL(href, window.location.origin).pathname;
      if (pathname && pathname !== '/') {
        const partialSelector = `a[href*="${CSS.escape(pathname)}"]`;
        if (document.querySelectorAll(partialSelector).length === 1) {
          return partialSelector;
        }
      }
    }
  }

  // Priority 5: Buttons/links by text content
  if (['BUTTON', 'A', 'SPAN', 'DIV'].includes(element.tagName)) {
    const text = element.textContent?.trim();
    if (text && text.length > 0 && text.length < 50) {
      // Try to find by text using xpath-like approach with contains
      const tag = element.tagName.toLowerCase();
      const candidates = document.querySelectorAll(tag);
      const matches = Array.from(candidates).filter(el => el.textContent?.trim() === text);
      if (matches.length === 1) {
        // Store text for later matching
        return `${tag}:text("${text.replace(/"/g, '\\"')}")`;
      }
    }
  }

  // Priority 6: aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const selector = `[aria-label="${CSS.escape(ariaLabel)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Priority 7: title attribute
  const title = element.getAttribute('title');
  if (title) {
    const selector = `[title="${CSS.escape(title)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Priority 8: Unique class combination
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.trim().split(/\s+/).filter(c => isStableClass(c));
    if (classes.length > 0) {
      const selector = `${element.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // Priority 9: Placeholder for inputs
  if (element.tagName === 'INPUT' && element.placeholder) {
    const selector = `input[placeholder="${CSS.escape(element.placeholder)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Priority 10: CSS path (fallback)
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
    let foundUniqueAttr = false;

    // Check for stable ID
    if (current.id && isStableId(current.id)) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // Check for unique identifying attributes
    const uniqueAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-id', 'name', 'aria-label', 'role'];
    for (const attr of uniqueAttrs) {
      const value = current.getAttribute(attr);
      if (value) {
        const attrSelector = `${selector}[${attr}="${CSS.escape(value)}"]`;
        if (document.querySelectorAll(attrSelector).length === 1) {
          path.unshift(attrSelector);
          foundUniqueAttr = true;
          break;
        }
      }
    }

    if (!foundUniqueAttr) {
      // Add stable classes if available
      if (current.className && typeof current.className === 'string') {
        const stableClasses = current.className.trim().split(/\s+/).filter(c => isStableClass(c)).slice(0, 2);
        if (stableClasses.length > 0) {
          selector += '.' + stableClasses.map(c => CSS.escape(c)).join('.');
        }
      }

      // Only add nth-of-type if absolutely necessary
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          // Check if our selector with classes is unique among siblings
          const matchingSiblings = siblings.filter(sib => {
            if (sib === current) return true;
            const sibClasses = sib.className && typeof sib.className === 'string' ? sib.className.trim().split(/\s+/) : [];
            const curClasses = current.className && typeof current.className === 'string' ? current.className.trim().split(/\s+/) : [];
            return sibClasses.join(' ') === curClasses.join(' ');
          });
          if (matchingSiblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
      }

      path.unshift(selector);
    }

    current = current.parentElement;

    // Limit path depth
    if (path.length > 4) break;
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
        // Check for text-based selector
        const textMatch = sel.match(/^(\w+):text\("(.+)"\)$/);
        if (textMatch) {
          const [, tag, text] = textMatch;
          const unescapedText = text.replace(/\\"/g, '"');
          const candidates = document.querySelectorAll(tag);
          for (const el of candidates) {
            if (el.textContent?.trim() === unescapedText && isVisible(el)) {
              return el;
            }
          }
          continue;
        }

        // Try exact match
        const element = document.querySelector(sel);
        if (element && isVisible(element)) {
          return element;
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
