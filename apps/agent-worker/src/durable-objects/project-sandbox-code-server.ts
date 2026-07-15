import { CODE_SERVER_PORT } from "@cheatcode/preview-bridge";

export const CODE_SERVER_DISPLAY_DIR = "/home/node/Computer";
export { CODE_SERVER_PORT };
export const CODE_SERVER_PROCESS_ID = "code-server";
export const CODE_SERVER_SETTINGS_MARKER =
  "/home/node/.local/share/code-server/user-data/.cheatcode-settings-v6";
export const CODE_SERVER_START_TIMEOUT_MS = 120_000;

export function codeServerFolderUrl(rawUrl: string, folderPath: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("folder", folderPath);
  return url.toString();
}

export function codeServerStartCommand(): string {
  const settingsJson = JSON.stringify(codeServerSettings(), null, 2);
  const values = codeServerShellValues();
  return [
    "set -euo pipefail",
    `PORT="${values.portDefault}"`,
    `WORKSPACE="${values.workspaceDefault}"`,
    `USER_DATA_DIR="${values.userDataDefault}"`,
    `EXTENSIONS_DIR="${values.extensionsDefault}"`,
    `TRUSTED_ORIGINS="${values.trustedOriginsDefault}"`,
    'mkdir -p "$USER_DATA_DIR/User" "$EXTENSIONS_DIR"',
    "cat > \"$USER_DATA_DIR/User/settings.json\" <<'JSON'",
    settingsJson,
    "JSON",
    "cat > \"$USER_DATA_DIR/User/keybindings.json\" <<'JSON'",
    "[]",
    "JSON",
    'rm -rf "$USER_DATA_DIR/User/workspaceStorage"',
    'touch "$USER_DATA_DIR/.cheatcode-settings-v6"',
    "export CS_DISABLE_GETTING_STARTED_OVERRIDE=1",
    'EXTRA_FLAGS=""',
    'if code-server --help 2>/dev/null | grep -q -- "--disable-getting-started-override"; then',
    '  EXTRA_FLAGS="$EXTRA_FLAGS --disable-getting-started-override"',
    "fi",
    'if code-server --help 2>/dev/null | grep -q -- "--disable-workspace-trust"; then',
    '  EXTRA_FLAGS="$EXTRA_FLAGS --disable-workspace-trust"',
    "fi",
    'IFS="," read -r -a TRUSTED_ORIGIN_LIST <<< "$TRUSTED_ORIGINS"',
    `for TRUSTED_ORIGIN in "${values.trustedOriginListExpansion}"; do`,
    `  TRUSTED_ORIGIN="${values.trustedOriginTrimLeading}"`,
    `  TRUSTED_ORIGIN="${values.trustedOriginTrimTrailing}"`,
    '  if [ -n "$TRUSTED_ORIGIN" ]; then',
    '    EXTRA_FLAGS="$EXTRA_FLAGS --trusted-origins $TRUSTED_ORIGIN"',
    "  fi",
    "done",
    'exec code-server "$WORKSPACE" \\',
    "  --auth none \\",
    `  --bind-addr "0.0.0.0:${values.portExpansion}" \\`,
    "  --disable-telemetry \\",
    "  --disable-update-check \\",
    '  --extensions-dir "$EXTENSIONS_DIR" \\',
    '  --user-data-dir "$USER_DATA_DIR" \\',
    "  $EXTRA_FLAGS",
  ].join("\n");
}

interface CodeServerShellValues {
  extensionsDefault: string;
  portDefault: string;
  portExpansion: string;
  trustedOriginListExpansion: string;
  trustedOriginTrimLeading: string;
  trustedOriginTrimTrailing: string;
  trustedOriginsDefault: string;
  userDataDefault: string;
  workspaceDefault: string;
}

function codeServerShellValues(): CodeServerShellValues {
  return {
    extensionsDefault: shellExpansion(
      "CODE_SERVER_EXTENSIONS_DIR:-/home/node/.local/share/code-server/extensions",
    ),
    portDefault: shellExpansion("CODE_SERVER_PORT:-13340"),
    portExpansion: shellExpansion("PORT"),
    trustedOriginListExpansion: shellExpansion("TRUSTED_ORIGIN_LIST[@]"),
    trustedOriginTrimLeading: shellExpansion(
      `TRUSTED_ORIGIN#"${shellExpansion("TRUSTED_ORIGIN%%[![:space:]]*")}"`,
    ),
    trustedOriginTrimTrailing: shellExpansion(
      `TRUSTED_ORIGIN%"${shellExpansion("TRUSTED_ORIGIN##*[![:space:]]")}"`,
    ),
    trustedOriginsDefault: shellExpansion(
      "CODE_SERVER_TRUSTED_ORIGINS:-localhost:8787,*.localhost:8787",
    ),
    userDataDefault: shellExpansion(
      "CODE_SERVER_USER_DATA_DIR:-/home/node/.local/share/code-server/user-data",
    ),
    workspaceDefault: shellExpansion("CODE_SERVER_WORKSPACE:-/workspace"),
  };
}

export function codeServerTrustedOrigins(previewHostname: string): string {
  const previewOrigin = previewHostname.trim().toLowerCase();
  const origins = ["localhost:8787", "*.localhost:8787"];
  if (previewOrigin !== "localhost:8787") {
    origins.push(`*.${previewOrigin}`);
  }
  return origins.join(",");
}

function codeServerSettings(): Record<string, unknown> {
  return {
    "breadcrumbs.enabled": false,
    "chat.commandCenter.enabled": false,
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
    "security.workspace.trust.enabled": false,
    "telemetry.telemetryLevel": "off",
    "update.showReleaseNotes": false,
    "window.autoDetectColorScheme": true,
    "window.commandCenter": true,
    "window.menuBarVisibility": "hidden",
    "window.titleBarStyle": "custom",
    "workbench.activityBar.location": "hidden",
    "workbench.activityBar.visible": false,
    "workbench.colorCustomizations": CODE_SERVER_COLORS,
    "workbench.editor.empty.hint": "hidden",
    "workbench.editor.enablePreview": false,
    "workbench.editorAssociations": {
      "*.ppt": "muty-pptviewer.preview",
      "*.pptx": "muty-pptviewer.preview",
    },
    "workbench.layoutControl.enabled": false,
    "workbench.panel.defaultLocation": "bottom",
    "workbench.preferredDarkColorTheme": "Default Dark Modern",
    "workbench.preferredLightColorTheme": "Default Light Modern",
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "workbench.startupEditor": "none",
    "workbench.statusBar.visible": false,
    "workbench.tips.enabled": false,
    "workbench.welcomePage.walkthroughs.openOnInstall": false,
  };
}

const CODE_SERVER_COLORS: Record<string, unknown> = {
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
    focusBorder: "#00000000",
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
    "titleBar.inactiveForeground": "#fafafa99",
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
    "titleBar.inactiveForeground": "#616161",
  },
};

function shellExpansion(expression: string): string {
  return ["$", "{", expression, "}"].join("");
}
