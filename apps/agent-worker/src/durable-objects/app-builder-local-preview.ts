import { shellQuote } from "../sandbox-support";
import { NEXT_RUNTIME_BIN, projectLocalSourceDir } from "./project-sandbox-package-runtime";

interface LocalPreviewCommandInput {
  port: number;
  sourceDir: string;
  workspaceSlug: string;
}

const PREVIEW_MIRROR_SYNC_SCRIPT = `
import os
import shutil
import sys
import time

IGNORED_DIRS = {".expo", ".next", "node_modules"}
LOCAL_ONLY_NAMES = IGNORED_DIRS | {"next-env.d.ts"}

def remove_path(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.unlink(path)

def sync_link(source, target):
    link = os.readlink(source)
    if os.path.islink(target) and os.readlink(target) == link:
        return
    remove_path(target)
    os.symlink(link, target)

def sync_file(entry, target, force):
    source_stat = entry.stat(follow_symlinks=False)
    try:
        target_stat = os.stat(target, follow_symlinks=False)
    except FileNotFoundError:
        target_stat = None
    changed = (
        force
        or target_stat is None
        or not os.path.isfile(target)
        or source_stat.st_size != target_stat.st_size
        or source_stat.st_mtime_ns > target_stat.st_mtime_ns
    )
    if changed:
        remove_path(target)
        shutil.copy2(entry.path, target, follow_symlinks=False)

def sync_directory(source, target, force=False):
    if os.path.lexists(target) and not os.path.isdir(target):
        remove_path(target)
    os.makedirs(target, exist_ok=True)
    source_names = set()
    for entry in os.scandir(source):
        if entry.name in IGNORED_DIRS:
            continue
        source_names.add(entry.name)
        destination = os.path.join(target, entry.name)
        try:
            if entry.is_symlink():
                sync_link(entry.path, destination)
            elif entry.is_dir(follow_symlinks=False):
                sync_directory(entry.path, destination, force)
            elif entry.is_file(follow_symlinks=False):
                sync_file(entry, destination, force)
        except FileNotFoundError:
            continue
    for entry in os.scandir(target):
        if entry.name not in source_names and entry.name not in LOCAL_ONLY_NAMES:
            remove_path(entry.path)

def synchronize(source, target, force):
    sync_directory(source, target, force)

source_dir, target_dir, mode = sys.argv[1:4]
if mode == "once":
    synchronize(source_dir, target_dir, True)
else:
    while True:
        try:
            synchronize(source_dir, target_dir, False)
        except OSError:
            pass
        time.sleep(0.75)
`;

/** Runs Next from native sandbox disk while `/workspace` remains the durable project source. */
export function localNextPreviewCommand(input: LocalPreviewCommandInput): string[] {
  const localSourceDir = projectLocalSourceDir(input.workspaceSlug);
  const syncCommand = ["python3", "-c", PREVIEW_MIRROR_SYNC_SCRIPT, input.sourceDir, localSourceDir]
    .map(shellQuote)
    .join(" ");
  const nextCommand = [
    NEXT_RUNTIME_BIN,
    "dev",
    "--webpack",
    "--hostname",
    "0.0.0.0",
    "--port",
    String(input.port),
  ]
    .map(shellQuote)
    .join(" ");
  const command = [
    `${syncCommand} once || exit $?`,
    `${syncCommand} loop &`,
    "sync_pid=$!",
    `cd ${shellQuote(localSourceDir)} || exit $?`,
    `${nextCommand} &`,
    "app_pid=$!",
    'terminate() { kill -TERM "$app_pid" "$sync_pid" 2>/dev/null || true; }',
    "trap terminate HUP INT TERM",
    'wait "$app_pid"',
    "status=$?",
    'kill "$sync_pid" 2>/dev/null || true',
    'wait "$sync_pid" 2>/dev/null || true',
    'exit "$status"',
  ].join("\n");
  return ["sh", "-lc", command];
}
