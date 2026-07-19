#!/usr/bin/env bash
set -euo pipefail

PORT="${CODE_SERVER_PORT:-13340}"
WORKSPACE="${CODE_SERVER_WORKSPACE:-/workspace}"
USER_DATA_DIR="${CODE_SERVER_USER_DATA_DIR:-/home/node/.local/share/code-server/user-data}"
EXTENSIONS_DIR="${CODE_SERVER_EXTENSIONS_DIR:-/home/node/.local/share/code-server/extensions}"
TRUSTED_ORIGINS="${CODE_SERVER_TRUSTED_ORIGINS:-localhost:8787,*.localhost:8787}"

mkdir -p "$USER_DATA_DIR/User" "$EXTENSIONS_DIR"

cat > "$USER_DATA_DIR/User/settings.json" <<'JSON'
{
  "breadcrumbs.enabled": false,
  "editor.fontFamily": "Menlo, Monaco, 'Courier New', monospace",
  "editor.fontSize": 13,
  "editor.lineHeight": 20,
  "editor.minimap.enabled": false,
  "explorer.confirmDelete": false,
  "explorer.confirmDragAndDrop": false,
  "explorer.openEditors.visible": 0,
  "extensions.ignoreRecommendations": true,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 800,
  "git.decorations.enabled": false,
  "git.enabled": false,
  "muty-pptviewer.libreOfficePath": "/usr/bin/libreoffice",
  "chat.commandCenter.enabled": false,
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.showReleaseNotes": false,
  "window.autoDetectColorScheme": true,
  "window.commandCenter": true,
  "window.menuBarVisibility": "hidden",
  "window.titleBarStyle": "custom",
  "workbench.activityBar.location": "hidden",
  "workbench.activityBar.visible": false,
  "workbench.colorCustomizations": {
    "[Default Dark Modern]": {
      "activityBar.background": "#141414",
      "activityBar.foreground": "#fafafa",
      "activityBar.inactiveForeground": "#fafafa66",
      "breadcrumb.background": "#141414",
      "breadcrumb.focusForeground": "#e0e0e0",
      "breadcrumb.foreground": "#a1a1a1",
      "button.background": "#fafafa",
      "button.foreground": "#0e100f",
      "button.hoverBackground": "#e5e5e5",
      "button.secondaryBackground": "#262626",
      "button.secondaryForeground": "#fafafa",
      "commandCenter.background": "#ffffff0d",
      "commandCenter.border": "#fafafa33",
      "commandCenter.foreground": "#fafafa",
      "dropdown.background": "#1d1e1d",
      "dropdown.border": "#ffffff1a",
      "dropdown.foreground": "#fafafa",
      "editor.background": "#141414",
      "editor.foreground": "#fafafa",
      "editorGroup.border": "#ffffff1a",
      "editorGroupHeader.tabsBackground": "#141414",
      "focusBorder": "#00000000",
      "input.background": "#1d1e1d",
      "input.border": "#ffffff26",
      "input.foreground": "#fafafa",
      "list.activeSelectionBackground": "#262626",
      "list.activeSelectionForeground": "#fafafa",
      "list.focusBackground": "#262626",
      "list.hoverBackground": "#262626",
      "list.hoverForeground": "#fafafa",
      "panel.background": "#141414",
      "scrollbarSlider.activeBackground": "#a1a1a1b3",
      "scrollbarSlider.background": "#a1a1a14d",
      "scrollbarSlider.hoverBackground": "#a1a1a180",
      "sideBar.background": "#141414",
      "sideBar.border": "#ffffff1a",
      "sideBar.foreground": "#fafafa",
      "sideBarTitle.foreground": "#fafafa",
      "statusBar.background": "#141414",
      "tab.activeBackground": "#141414",
      "tab.activeForeground": "#fafafa",
      "tab.border": "#ffffff1a",
      "tab.inactiveBackground": "#141414",
      "tab.inactiveForeground": "#a1a1a1",
      "titleBar.activeBackground": "#141414",
      "titleBar.activeForeground": "#fafafa",
      "titleBar.inactiveBackground": "#141414",
      "titleBar.inactiveForeground": "#fafafa99"
    },
    "[Default Light Modern]": {
      "activityBar.background": "#f8f8f8",
      "activityBar.foreground": "#1a1a1a",
      "activityBar.inactiveForeground": "#616161",
      "editor.background": "#ffffff",
      "editor.foreground": "#616161",
      "editorGroupHeader.tabsBackground": "#f8f8f8",
      "panel.background": "#ffffff",
      "sideBar.background": "#f8f8f8",
      "sideBar.foreground": "#1a1a1a",
      "sideBarTitle.foreground": "#1a1a1a",
      "statusBar.background": "#f8f8f8",
      "tab.activeBackground": "#ffffff",
      "tab.activeForeground": "#1a1a1a",
      "tab.inactiveBackground": "#f8f8f8",
      "tab.inactiveForeground": "#616161",
      "titleBar.activeBackground": "#f8f8f8",
      "titleBar.activeForeground": "#1a1a1a",
      "titleBar.inactiveBackground": "#f8f8f8",
      "titleBar.inactiveForeground": "#616161"
    }
  },
  "workbench.editor.empty.hint": "hidden",
  "workbench.editor.enablePreview": false,
  "workbench.editorAssociations": {
    "*.ppt": "muty-pptviewer.preview",
    "*.pptx": "muty-pptviewer.preview"
  },
  "workbench.layoutControl.enabled": false,
  "workbench.panel.defaultLocation": "bottom",
  "workbench.preferredDarkColorTheme": "Default Dark Modern",
  "workbench.preferredLightColorTheme": "Default Light Modern",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "workbench.startupEditor": "none",
  "workbench.statusBar.visible": false,
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false
}
JSON

cat > "$USER_DATA_DIR/User/keybindings.json" <<'JSON'
[]
JSON

rm -rf "$USER_DATA_DIR/User/workspaceStorage"
touch "$USER_DATA_DIR/.cheatcode-settings-v6"
export CS_DISABLE_GETTING_STARTED_OVERRIDE=1

EXTRA_FLAGS=()
if code-server --help 2>/dev/null | grep -q -- "--disable-getting-started-override"; then
  EXTRA_FLAGS+=(--disable-getting-started-override)
fi
if code-server --help 2>/dev/null | grep -q -- "--disable-workspace-trust"; then
  EXTRA_FLAGS+=(--disable-workspace-trust)
fi
IFS="," read -r -a TRUSTED_ORIGIN_LIST <<< "$TRUSTED_ORIGINS"
for TRUSTED_ORIGIN in "${TRUSTED_ORIGIN_LIST[@]}"; do
  TRUSTED_ORIGIN="${TRUSTED_ORIGIN#"${TRUSTED_ORIGIN%%[![:space:]]*}"}"
  TRUSTED_ORIGIN="${TRUSTED_ORIGIN%"${TRUSTED_ORIGIN##*[![:space:]]}"}"
  if [ -n "$TRUSTED_ORIGIN" ]; then
    EXTRA_FLAGS+=(--trusted-origins "$TRUSTED_ORIGIN")
  fi
done

exec code-server "$WORKSPACE" \
  --auth none \
  --bind-addr "0.0.0.0:${PORT}" \
  --disable-telemetry \
  --disable-update-check \
  --extensions-dir "$EXTENSIONS_DIR" \
  --user-data-dir "$USER_DATA_DIR" \
  "${EXTRA_FLAGS[@]}"
