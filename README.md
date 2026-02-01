# Wave

Browser automation that flows. Record and replay workflows in Chrome.

## Features

- **Record**: Capture clicks and inputs as you interact with websites
- **Replay**: Run saved workflows with one click
- **Health Checks**: Schedule workflows to run automatically (30min to daily)
- **Import/Export**: Share workflows as JSON files

## Installation

1. Clone this repository
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the folder

## Usage

### Recording

1. Click the Wave extension icon (opens Wave in a new tab)
2. Enter a workflow name
3. Click **Start Recording**
4. Wave automatically switches to your last visited tab and starts recording
5. Interact with the page (clicks, form inputs)
6. Return to Wave tab and click **Stop & Save**

### Playback

1. Open Wave
2. Click the **Play** button on any workflow
3. Wave executes each step in sequence

### Health Checks

Schedule workflows to run automatically:

1. Click the **Clock** icon on a workflow
2. Select interval (30min, 1h, 6h, 12h, daily)
3. Wave runs the workflow in a background tab
4. Get notified if it fails

## How It Works

Wave uses three components:

| Component | Purpose |
|-----------|---------|
| **Background Service** | Manages state, storage, and coordinates recording/playback |
| **Content Script** | Injected into pages to capture events and execute steps |
| **Popup UI** | Full-page interface for managing workflows |

### Selector Generation

Wave generates stable selectors in this priority:

1. `#id` (if stable-looking)
2. `[data-testid]`, `[data-cy]`
3. `input[name]`, `select[name]`
4. Unique class combinations
5. `[aria-label]`
6. CSS path fallback

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access current tab for recording |
| `storage` | Save workflows locally |
| `tabs` | Switch tabs, get tab info |
| `scripting` | Inject content script |
| `alarms` | Schedule health checks |
| `notifications` | Alert on health check failures |
| `<all_urls>` | Record/play on any website |

## Files

```
wave-extension/
├── manifest.json
├── src/
│   ├── background/
│   │   └── background.js    # Service worker
│   ├── content/
│   │   └── content.js       # Page interaction
│   └── popup/
│       ├── popup.html       # UI
│       ├── popup.css        # Styles
│       └── popup.js         # UI logic
└── icons/
    └── wave-*.png
```

## License

MIT
