---
name: browser-use
description: Browser automation CLI for the Cheatcode coding agent. Use when the user needs to interact with websites, take screenshots, fill forms, click elements, navigate pages, or automate any browser task.
category: Builder & Apps
tags: browser, automation, screenshots, qa
compatibility: Requires the preinstalled cheatcode-browser CLI and headed Chromium runtime.
allowed-tools: shell_exec browser_open browser_act browser_observe browser_extract browser_screenshot
---

# Browser Use

Use `cheatcode-browser` for all browser automation — navigating pages, interacting with elements, taking screenshots, extracting data, and testing web apps.

The `--cloud` flag spins up a remote cloud browser instance, so there is no need to install or run a browser locally in the sandbox.

## Command

```bash
cheatcode-browser --cloud <action> [args...] [flags]
```

## Cheatcode tool contract

Run every `cheatcode-browser` command with `shell_exec` and pass the command as an argv array.
Do not use `shell_terminal` for browser commands: it is reserved for persistent project work and
attaches a project workspace. Browser-only work must remain projectless.

For example, this documented shell command:

```bash
cheatcode-browser --cloud open https://example.com
```

must be sent to `shell_exec` as:

```json
{"command":["cheatcode-browser","--cloud","open","https://example.com"]}
```

Issue sequential `shell_exec` calls when commands depend on earlier output. Do not turn `&&`
examples in this document into `shell_terminal` calls. If `cheatcode-browser` is unavailable,
fall back directly to the native `browser_open`, `browser_observe`, `browser_act`,
`browser_extract`, and `browser_screenshot` tools without creating a project.

## Before You Act — THINK FIRST

**CRITICAL: Before issuing any browser commands, stop and reason about the task.** Do not jump straight into commands. Browser automation fails when you act mechanically without understanding the website.

### 1. Understand the end goal
What is the user actually trying to accomplish? If they say "find the cheapest flight from SF to NYC," the goal isn't "click a search box" — it's navigating an airline/travel site's full search flow: entering origin, destination, dates, hitting search, reading results, and comparing prices. Plan the full sequence before starting.

### 2. Anticipate the site structure
Think about what kind of website you're working with and how it's likely organized:
- **E-commerce** (Amazon, Shopify): search bar → results grid → product detail → cart → checkout
- **Search engines** (Google, DuckDuckGo): search box → results list with links → target pages
- **Auth-gated apps** (dashboards, SaaS): login page → redirect → sidebar/nav → content views
- **Content sites** (Wikipedia, docs): nav/sidebar → article content → internal links
- **Forms/wizards**: multi-step flows with validation, progress indicators, conditional fields

Knowing the pattern tells you what to expect after each action.

### 3. Plan for state transitions
Every action changes the page. Before you click or submit, ask yourself:
- Will this navigate to a new page or stay on the same one?
- Will a modal, dropdown, or toast appear?
- Will there be a loading spinner or network delay?
- Could this trigger a redirect (e.g., auth redirect, region redirect)?

**Always re-snapshot after a state change** to confirm you're where you expect.

### 4. Handle obstacles proactively
Real websites have friction. Before interacting with main content, check for and dismiss:
- Cookie consent banners / GDPR popups
- Login walls or signup modals
- CAPTCHA challenges (use `request_user_control` for these)
- Newsletter popups or promotional overlays
- "Accept terms" dialogs

If you see these in a snapshot, handle them first.

### 5. Verify before proceeding
After each major step, confirm the page state before continuing. Don't chain 5 actions blindly — one failed click silently breaks everything after it. The pattern is: **act → verify (snapshot) → act → verify**.

## Core Workflow (DOM-based) — ALWAYS USE THIS FIRST

For standard web pages, use the **snapshot → use refs → re-snapshot** loop:

```bash
cheatcode-browser --cloud open https://example.com/form
cheatcode-browser --cloud snapshot -i
# Output: interactive element refs like @e1 [input "Email"], @e2 [input "Password"], @e3 [button "Submit"]
cheatcode-browser --cloud fill @e1 "user@example.com"
cheatcode-browser --cloud fill @e2 "password123"
cheatcode-browser --cloud click @e3
cheatcode-browser --cloud snapshot -i
```

**CRITICAL: When you have refs from a snapshot, ALWAYS use them.** Do NOT use `find`, CSS selectors, or any other locator strategy when you already have `@e` refs — refs are the fastest and most reliable way to target elements. Only use `find` when you need to locate elements without a prior snapshot.

After any navigation or DOM change (clicking a link, submitting a form, opening a modal), always re-snapshot to get fresh refs.

## Computer Use (Screenshot + Coordinates)

For tasks that are **not DOM-based** or where the DOM is hard to work with — canvas elements, maps, games, complex visual UIs, iframes, visual verification — use the **screenshot -> observe -> coordinate** loop:

```bash
cheatcode-browser --cloud screenshot --annotate
# Observe the screenshot to identify target coordinates
cheatcode-browser --cloud mouse click 150 300
cheatcode-browser --cloud screenshot
# Verify the result
```

Available coordinate actions:

```bash
cheatcode-browser --cloud mouse click <x> <y>           # Click at coordinates
cheatcode-browser --cloud mouse move <x> <y>             # Move cursor
cheatcode-browser --cloud mouse dblclick <x> <y>         # Double-click
cheatcode-browser --cloud mouse scroll <x> <y> <scroll_y> # Scroll at position
cheatcode-browser --cloud mouse down left                # Press mouse button
cheatcode-browser --cloud mouse up left                  # Release mouse button
cheatcode-browser --cloud mouse wheel 100                # Scroll wheel
cheatcode-browser --cloud keyboard type "some text"      # Type at current focus
cheatcode-browser --cloud press Enter                    # Press a key
```

**When to use coordinates vs DOM:**
- Prefer DOM-based actions (`click`, `fill`, `snapshot`) first — they are more reliable.
- Fall back to screenshot + coordinates when:
  - The page uses `<canvas>`, WebGL, or complex SVG that snapshots can't express
  - Elements are inside cross-origin iframes
  - You need to verify visual layout, colors, or positioning
  - The snapshot output is unclear or missing interactive elements

## Actions Reference

### Navigation
```bash
cheatcode-browser --cloud open <url>                     # Navigate to URL (aliases: goto, navigate)
cheatcode-browser --cloud close                          # Close browser (aliases: quit, exit)
cheatcode-browser --cloud tab                            # List tabs
cheatcode-browser --cloud tab new [url]                  # New tab (optionally with URL)
cheatcode-browser --cloud tab <n>                        # Switch to tab n
cheatcode-browser --cloud tab close [n]                  # Close tab (current if n omitted)
```

**Multi-tab workflows:** Always run `cheatcode-browser --cloud tab` first to list tabs and check which tab is currently active before switching or interacting. Tab indices can change after opening or closing tabs, so never assume a tab index — always list tabs to confirm.

### Observation
```bash
cheatcode-browser --cloud snapshot                       # Full accessibility tree
cheatcode-browser --cloud snapshot -i                    # Interactive elements only (recommended)
cheatcode-browser --cloud snapshot -c                    # Compact output
cheatcode-browser --cloud snapshot -d 3                  # Limit depth to 3
cheatcode-browser --cloud snapshot -s "#main"            # Scope to CSS selector
cheatcode-browser --cloud screenshot                     # Capture viewport
cheatcode-browser --cloud screenshot --full              # Full page screenshot
cheatcode-browser --cloud screenshot --annotate          # Screenshot with numbered element labels
```

**Screenshot path:** Do NOT save screenshots to `/tmp`. By default, screenshots are saved to the working directory (`/home/user/computer`). Only specify a path if the user explicitly asks to save to a specific location.

### DOM Interaction (use refs from snapshot)
```bash
cheatcode-browser --cloud click <selector>               # Click element
cheatcode-browser --cloud click <selector> --new-tab     # Click and open in new tab
cheatcode-browser --cloud dblclick <selector>            # Double-click
cheatcode-browser --cloud fill <selector> <text>         # Clear and type
cheatcode-browser --cloud type <selector> <text>         # Type without clearing
cheatcode-browser --cloud select <selector> <value>      # Select dropdown option
cheatcode-browser --cloud check <selector>               # Check checkbox
cheatcode-browser --cloud uncheck <selector>             # Uncheck checkbox
cheatcode-browser --cloud hover <selector>               # Hover element
cheatcode-browser --cloud focus <selector>               # Focus element
cheatcode-browser --cloud scroll down 500                # Scroll page
cheatcode-browser --cloud scroll down 500 --selector ".container"  # Scroll within element
cheatcode-browser --cloud scrollintoview <selector>      # Scroll element into view
cheatcode-browser --cloud drag <selector> <targetSelector>  # Drag and drop
cheatcode-browser --cloud upload <selector> <path>       # Upload file
cheatcode-browser --cloud download <selector> [path]     # Click element to trigger download
```

### Keyboard
```bash
cheatcode-browser --cloud press Enter                    # Press key
cheatcode-browser --cloud press Tab                      # Press Tab key
cheatcode-browser --cloud press Control+a                # Key combination (Ctrl+A)
cheatcode-browser --cloud press Control+c                # Copy
cheatcode-browser --cloud press Control+v                # Paste
cheatcode-browser --cloud press Escape                   # Escape
cheatcode-browser --cloud keyboard type "some text"      # Type at current focus
cheatcode-browser --cloud keyboard inserttext "text"     # Insert without key events
```

Note: `Meta`/`Command`/`Cmd` keys are automatically mapped to `Control` inside the sandbox (Linux environment). Use `Control+` for key combinations.

### Get Information
```bash
cheatcode-browser --cloud get text @e1                   # Get element text
cheatcode-browser --cloud get html @e1                   # Get innerHTML
cheatcode-browser --cloud get value @e1                  # Get input value
cheatcode-browser --cloud get attr @e1 href              # Get attribute
cheatcode-browser --cloud get title                      # Get page title
cheatcode-browser --cloud get url                        # Get current URL
cheatcode-browser --cloud get cdp-url                    # Get CDP WebSocket URL
cheatcode-browser --cloud get count ".item"              # Count matching elements
cheatcode-browser --cloud get box @e1                    # Get bounding box
cheatcode-browser --cloud get styles @e1                 # Get computed styles
```

### Wait
```bash
cheatcode-browser --cloud wait @e1                       # Wait for element
cheatcode-browser --cloud wait 2000                      # Wait milliseconds
cheatcode-browser --cloud wait --text "Success"           # Wait for text (or -t)
cheatcode-browser --cloud wait --url "**/dashboard"       # Wait for URL pattern (or -u)
cheatcode-browser --cloud wait --load networkidle         # Wait for network idle (or -l)
cheatcode-browser --cloud wait --fn "window.ready"        # Wait for JS condition (or -f)
cheatcode-browser --cloud wait --download [path]          # Wait for any download to complete
```

### Semantic Locators (only when you don't have refs)
Use `find` only when you haven't taken a snapshot or need to locate elements without refs. **If you have `@e` refs from a snapshot, always use those instead.**
```bash
cheatcode-browser --cloud find role button click --name "Submit"
cheatcode-browser --cloud find text "Sign In" click
cheatcode-browser --cloud find text "Sign In" click --exact   # Exact match only
cheatcode-browser --cloud find label "Email" fill "user@test.com"
cheatcode-browser --cloud find placeholder "Search Amazon" type "query"
cheatcode-browser --cloud find alt "Logo" click
cheatcode-browser --cloud find title "Close" click
cheatcode-browser --cloud find testid "submit-btn" click
cheatcode-browser --cloud find first ".item" click
cheatcode-browser --cloud find last ".item" click
cheatcode-browser --cloud find nth 2 "a" hover
```

### JavaScript
**IMPORTANT: `eval` runs code as a top-level expression. Do NOT use `return` — it causes `SyntaxError: Illegal return statement`. Just write the expression directly.**
```bash
cheatcode-browser --cloud eval 'document.title'
cheatcode-browser --cloud eval 'document.querySelectorAll("img").length'
cheatcode-browser --cloud eval 'JSON.stringify([...document.querySelectorAll("a")].map(a => a.href))'
```

### Session & User Control
```bash
cheatcode-browser --cloud get_live_preview_link           # Get interactive live preview URL
cheatcode-browser --cloud request_user_control --title "Title" --description "Instructions"  # Hand control to user
```

### Other
```bash
cheatcode-browser --cloud pdf /tmp/page.pdf              # Save as PDF
cheatcode-browser --cloud help                           # Show CLI help (also: --help, -h)
```

## Efficiency — CRITICAL

**Every Bash call is expensive.** Minimize round-trips aggressively. This is the #1 factor in browser automation speed.

### 1. Always use the snapshot flow first
Use `snapshot -i` → interact → re-snapshot. This is the fastest, most reliable approach. Only fall back to screenshots when the DOM can't express what you need.

### 2. Chain commands with `&&`
If you don't need intermediate output, chain multiple commands in a single Bash call:
```bash
cheatcode-browser --cloud open https://example.com && cheatcode-browser --cloud snapshot -i
```
```bash
cheatcode-browser --cloud fill @e1 "user@example.com" && cheatcode-browser --cloud fill @e2 "password" && cheatcode-browser --cloud click @e3 && cheatcode-browser --cloud snapshot -i
```

### 3. Use `eval` for bulk operations
A single `eval` replaces many individual calls. Use it for scraping, form filling, bulk interactions, and data extraction. **Never use `return` — just write the expression.**
```bash
cheatcode-browser --cloud eval 'JSON.stringify(Array.from(document.querySelectorAll("tr")).map(r => r.innerText))'
```
```bash
cheatcode-browser --cloud eval 'document.querySelectorAll("input[type=checkbox]").forEach(cb => { if (!cb.checked) cb.click() }); "done"'
```
```bash
cheatcode-browser --cloud eval 'JSON.stringify({ title: document.title, links: Array.from(document.querySelectorAll("a")).map(a => ({ text: a.innerText, href: a.href })) })'
```

### 4. Don't over-observe
- **Only snapshot/screenshot when you need fresh refs or visual confirmation.** If you already know the next selector or coordinate, just act.
- **Prefer `snapshot -i` over `snapshot`** — interactive-only is smaller and faster.
- **Prefer `snapshot` over `screenshot`** — text is fast, images are slow. Only use screenshots when you need visual information the DOM can't provide.

## Requesting User Control (Human-in-the-Loop)

When a task requires human interaction — typically logging in, solving a CAPTCHA, or confirming a sensitive action — hand control to the user:

```bash
cheatcode-browser --cloud request_user_control --title "Log in to GitHub" --description "Please sign in with your credentials. Click 'Return control' when done."
```

This halts the current agent run and shows the user a prompt with your title and description. The user interacts with the browser directly, then clicks **Return control** when finished. You may continue working after the user resumes.

**When to use:**
- Login / OAuth flows where the agent must not see credentials
- CAPTCHAs or 2FA prompts
- Any confirmation the user must do themselves

## Live Preview Link

Get an interactive browser preview URL that you can share with the user so they can see and interact with the current browser session directly:

```bash
cheatcode-browser --cloud get_live_preview_link
```

Returns a JSON object with `livePreviewUrl` — a URL the user can open to view and interact with the live browser session.

**When to use:**
- The user needs to manually interact with a page (login, CAPTCHA, review)
- You want to show the user what the browser is currently displaying
- Any situation where the user needs to see or do something in the browser themselves

**Always send the link via `sendMessage`** so the user can tap it directly.

## Tips

- **Use `--annotate`** on screenshots to get numbered labels on interactive elements — useful for finding coordinates or verifying which element is which.
- **Re-snapshot after DOM changes.** Element refs are invalidated after navigation, form submissions, or dynamic content loading.

## Errors

- If cloud mode cannot install the browser runtime in the sandbox, surface that install error directly.
