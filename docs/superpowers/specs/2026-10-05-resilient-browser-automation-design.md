# Resilient Browser Automation Design

## Goal

Make `brave-mcp` complete common browser tasks with fewer agent round trips, identify why actions fail, and recover safely when a deterministic recovery is available.

## Current findings

- `brave_act` supports click, type, press, scroll, hover, select, and file upload. There is no dedicated drag-and-drop, coordinate action, or download wait/result operation.
- `BrowserObserver` combines ARIA snapshot results and DOM results, but visibility/actionability checks differ between those sources. The DOM visibility check uses nonzero bounds and `visibility !== hidden`; its viewport test checks only the element's top-left point. Disabled/covered state is not consistently removed from candidates.
- `ActionEngine.getLocatorForRef` may resolve a role/name with `.first()`, so repeated names can make a reference ambiguous. Actions use fixed timeouts and return the initial failure without a diagnosis/recovery attempt.
- JavaScript dialogs have no explicit policy and Playwright dismisses them automatically when no handler is registered. Downloads are saved asynchronously by `BraveManager` and are not tied to the action receipt.
- Tool descriptions and README describe an isolated agent window, while current `BraveManager` attaches to the existing CDP browser and `getAgentPage()` aliases the currently visible page. This mismatch can make the selected target surprising.
- Playwright documentation provides established mechanisms for auto-waiting/actionability, input, dialogs, popups, downloads, and file chooser events. Recovery should use these APIs and preserve their safety checks rather than defaulting to forced DOM events.

## Design

### 1. Actionable observation

`brave_observe` will return a concise default set of visible, enabled interactive elements. An element is in the viewport when its bounding rectangle intersects the viewport, not only when its top-left corner is inside it. ARIA and DOM candidates will pass through consistent filtering and deduplication. Each actionable reference must resolve to one element in the same frame; ambiguous references are reported as ambiguous rather than silently selecting the first match.

Offscreen controls remain discoverable only through an explicit option or a deliberate broader filter. Observation output continues to include page alerts and compact references. The configured maximum remains enforced after deduplication.

### 2. Bounded action recovery

Action execution will retain Playwright's normal auto-wait and actionability checks. On a recognized failure, a recovery layer may perform a small, explicit set of safe operations: refresh stale observation data when possible, bring a uniquely resolved target into view, wait for a transient overlay/navigation to settle, and retry once when the failure evidence supports it. It must not bypass hit-target/actionability checks with force clicks or dispatch synthetic DOM clicks as a generic fallback.

When recovery cannot establish a safe next step, the result will identify the action, target, failure category, and next useful remedy (for example, target is disabled, reference is stale, target is covered, or frame is unavailable). It will not report an action as executed unless the action call succeeded.

### 3. High-value action workflows

Extend the action surface with:

- drag-and-drop between two uniquely resolved references;
- coordinate click for screenshot-grounded cases where no actionable DOM node exists, requiring explicit coordinates and viewport dimensions from the latest observation;
- explicit dialog handling (`accept`/`dismiss`, with prompt text where supported) that is deterministic and does not leave pages blocked;
- download-aware click support that waits for the associated download, saves it through the existing artifact path, and returns the filename/status in the receipt.

Keyboard chords and precise pointer interactions should be supported through existing keyboard/mouse primitives where useful, without adding a second general-purpose scripting language. Popup/new-tab behavior must be captured when an action explicitly requests it; normal click behavior should not unexpectedly change target tabs.

### 4. Target and result clarity

Tool descriptions will reflect the actual browser target behavior. Receipts will stay compact by default and include only the result, observed state change, any downloaded artifact, and recovery/failure details. `and_observe` remains available for workflows that need a next-step observation; batch execution remains the preferred path for known multi-step sequences.

## Error handling and limits

Automation is best-effort, not universal. Authentication challenges, CAPTCHA, OS-native UI, unavailable permissions, unsupported browser surfaces, and site-specific flows may still require user input. The server must surface those limits as a concise blocked/unsupported result rather than looping indefinitely or claiming completion. Retries are bounded to one recovery retry per action.

## Compatibility

- Preserve existing MCP tool names and existing action parameter behavior.
- New actions and options are additive.
- Preserve the existing connected Brave CDP session; do not launch another browser instance.
- Preserve user changes already present in `brave-mcp/src/actions.js` and `brave-mcp/src/index.js`.
- Update documentation that claims an isolated Agent Window if the implementation continues to target the visible existing tab.

## Validation

Add focused regression cases for hidden/disabled/partially visible elements, duplicate accessible names, stale references, covered targets, safe one-retry recovery, drag-and-drop, coordinate bounds validation, dialog accept/dismiss, download association, and concise failure receipts. Run the repository's required test battery and report any environment-dependent CDP test failure separately.

## Research references

- Playwright input and auto-scrolling: <https://playwright.dev/docs/input>
- Playwright actionability and auto-waiting: <https://playwright.dev/docs/actionability>
- Page events, dialogs, popups, downloads, and file chooser: <https://playwright.dev/docs/api/class-page>
- Download lifecycle and saving: <https://playwright.dev/docs/api/class-download>
