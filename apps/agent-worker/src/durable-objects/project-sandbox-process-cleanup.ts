/** Kills every sandbox process whose real cwd is the exact project directory or a child. */
export const WORKSPACE_PROCESS_TERMINATION_SCRIPT = `
import os
import signal
import stat
import sys
import time

root = sys.argv[1]
try:
    metadata = os.lstat(root)
except FileNotFoundError:
    metadata = None
if metadata is not None and stat.S_ISLNK(metadata.st_mode):
    print("Project workspace is a symbolic link", file=sys.stderr)
    raise SystemExit(2)

root = os.path.realpath(root) if metadata is not None else os.path.abspath(root)
prefix = root + os.sep
self_pid = os.getpid()
self_uid = os.getuid()

def matching_pids():
    matches = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        pid = int(name)
        if pid == self_pid:
            continue
        try:
            if os.stat(f"/proc/{pid}").st_uid != self_uid:
                continue
            cwd = os.readlink(f"/proc/{pid}/cwd")
        except (FileNotFoundError, ProcessLookupError):
            continue
        except OSError as error:
            raise RuntimeError(f"Could not inspect cwd for process {pid}: {error}") from error
        if cwd.endswith(" (deleted)"):
            cwd = cwd.removesuffix(" (deleted)")
        if cwd == root or cwd.startswith(prefix):
            matches.append(pid)
    return matches

def send(pids, sig):
    denied = []
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            continue
        except PermissionError:
            denied.append(pid)
    return denied

denied = send(matching_pids(), signal.SIGTERM)
deadline = time.monotonic() + 3
remaining = matching_pids()
while remaining and time.monotonic() < deadline:
    time.sleep(0.1)
    remaining = matching_pids()
denied.extend(send(remaining, signal.SIGKILL))
time.sleep(0.1)
survivors = matching_pids()
if denied or survivors:
    print(f"Could not terminate workspace processes: denied={denied} survivors={survivors}", file=sys.stderr)
    raise SystemExit(1)
`;

/** Kills every same-user sandbox process except the cleanup command's control-plane ancestry. */
export const SANDBOX_PROCESS_TERMINATION_SCRIPT = `
import os
import signal
import sys
import time

self_pid = os.getpid()
self_uid = os.getuid()

def process_fields(pid):
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as handle:
            fields = handle.read().rsplit(")", 1)[1].split()
    except (FileNotFoundError, ProcessLookupError):
        return None
    if len(fields) < 2:
        raise RuntimeError(f"Could not parse process metadata for {pid}")
    return fields

def parent_pid(pid):
    fields = process_fields(pid)
    return 0 if fields is None else int(fields[1])

protected = {self_pid}
ancestor = self_pid
while ancestor > 1:
    ancestor = parent_pid(ancestor)
    if ancestor <= 0:
        break
    protected.add(ancestor)

def matching_pids():
    matches = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        pid = int(name)
        if pid in protected:
            continue
        try:
            fields = process_fields(pid)
            if fields is not None and fields[0] != "Z" and os.stat(f"/proc/{pid}").st_uid == self_uid:
                matches.append(pid)
        except (FileNotFoundError, ProcessLookupError):
            continue
        except OSError as error:
            raise RuntimeError(f"Could not inspect process {pid}: {error}") from error
    return matches

def send(pids, sig):
    denied = []
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            continue
        except PermissionError:
            denied.append(pid)
    return denied

denied = send(matching_pids(), signal.SIGTERM)
deadline = time.monotonic() + 3
remaining = matching_pids()
while remaining and time.monotonic() < deadline:
    time.sleep(0.1)
    remaining = matching_pids()
denied.extend(send(remaining, signal.SIGKILL))
time.sleep(0.1)
survivors = matching_pids()
if denied or survivors:
    print(f"Could not terminate sandbox processes: denied={denied} survivors={survivors}", file=sys.stderr)
    raise SystemExit(1)
`;
