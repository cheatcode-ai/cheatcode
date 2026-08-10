#!/usr/bin/env python3
"""Synchronize durable project source with its sandbox-local native-disk mirror."""

import fcntl
import hashlib
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time


IGNORED_DIRS = {".expo", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "out"}
LOCAL_ONLY_NAMES = IGNORED_DIRS | {"next-env.d.ts"}
PACKAGE_CONFLICT_EXIT = 74
DEPENDENCY_STATE_FILENAME = ".cheatcode-dependency-state"


def remove_path(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.unlink(path)


def file_digest(path):
    value = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def atomic_local_copy(source, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".cheatcode-sync-", dir=os.path.dirname(target))
    os.close(descriptor)
    try:
        shutil.copyfile(source, temporary, follow_symlinks=False)
        shutil.copymode(source, temporary, follow_symlinks=False)
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def sync_local_link(source, target):
    link = os.readlink(source)
    if os.path.islink(target) and os.readlink(target) == link:
        return
    os.makedirs(os.path.dirname(target), exist_ok=True)
    temporary = f"{target}.cheatcode-sync-{os.getpid()}"
    remove_path(temporary)
    try:
        os.symlink(link, temporary)
        remove_path(target)
        os.replace(temporary, target)
    finally:
        remove_path(temporary)


def sync_file(source, target):
    if os.path.isfile(target) and not os.path.islink(target):
        try:
            if os.path.getsize(source) == os.path.getsize(target) and file_digest(source) == file_digest(target):
                return
        except FileNotFoundError:
            pass
    if os.path.isdir(target) or os.path.islink(target):
        remove_path(target)
    atomic_local_copy(source, target)


def sync_directory(source, target):
    if os.path.islink(target) or (os.path.lexists(target) and not os.path.isdir(target)):
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
                sync_local_link(entry.path, destination)
            elif entry.is_dir(follow_symlinks=False):
                sync_directory(entry.path, destination)
            elif entry.is_file(follow_symlinks=False):
                sync_file(entry.path, destination)
        except FileNotFoundError:
            continue
    for entry in os.scandir(target):
        if entry.name not in source_names and entry.name not in LOCAL_ONLY_NAMES:
            remove_path(entry.path)


def tree_state(root):
    state = {}
    if not os.path.isdir(root):
        return state
    for current, dir_names, file_names in os.walk(root, topdown=True, followlinks=False):
        dir_names[:] = sorted(name for name in dir_names if name not in IGNORED_DIRS)
        relative_root = os.path.relpath(current, root)
        for name in dir_names:
            path = os.path.join(current, name)
            relative = os.path.normpath(os.path.join(relative_root, name))
            state[relative] = ["link", os.readlink(path)] if os.path.islink(path) else ["dir"]
        for name in sorted(file_names):
            if name in LOCAL_ONLY_NAMES:
                continue
            path = os.path.join(current, name)
            relative = os.path.normpath(os.path.join(relative_root, name))
            state[relative] = (
                ["link", os.readlink(path)] if os.path.islink(path) else ["file", file_digest(path)]
            )
    return state


def open_lock(lock_path):
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    return open(lock_path, "a+", encoding="utf-8")


def try_lock(lock):
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False


def preview_sync(source, target, mode, lock_path):
    is_once = mode == "preview-once"
    while True:
        with open_lock(lock_path) as lock:
            if is_once:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
                sync_directory(source, target)
            elif try_lock(lock):
                sync_directory(source, target)
        if is_once:
            return
        time.sleep(0.25)


def overwrite_durable_file(source, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(source, "rb") as source_file, open(target, "wb") as target_file:
        shutil.copyfileobj(source_file, target_file, 1024 * 1024)
        target_file.flush()
    if not files_equal(source, target):
        raise OSError(f"durable file verification failed: {target}")


def overwrite_durable_link(source, target):
    link = os.readlink(source)
    if os.path.islink(target) and os.readlink(target) == link:
        return
    remove_path(target)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    os.symlink(link, target)


def copy_state_to_durable(source_root, target_root, relative, state):
    source = os.path.join(source_root, relative)
    target = os.path.join(target_root, relative)
    kind = state[0]
    if kind == "dir":
        if os.path.islink(target) or (os.path.lexists(target) and not os.path.isdir(target)):
            remove_path(target)
        os.makedirs(target, exist_ok=True)
        return
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if kind == "link":
        overwrite_durable_link(source, target)
        return
    if os.path.isdir(target) or os.path.islink(target):
        remove_path(target)
    overwrite_durable_file(source, target)


def commit_local_changes(durable_root, local_root, baseline):
    local = tree_state(local_root)
    durable = tree_state(durable_root)
    changed = sorted(path for path in set(baseline) | set(local) if baseline.get(path) != local.get(path))
    conflicts = [
        path
        for path in changed
        if durable.get(path) != baseline.get(path) and durable.get(path) != local.get(path)
    ]
    if conflicts:
        raise RuntimeError("durable project changed during package command: " + ", ".join(conflicts[:8]))
    for relative in sorted(
        (path for path in changed if path not in local),
        key=lambda value: value.count(os.sep),
        reverse=True,
    ):
        remove_path(os.path.join(durable_root, relative))
    for relative in sorted(
        (path for path in changed if path in local),
        key=lambda value: value.count(os.sep),
    ):
        copy_state_to_durable(local_root, durable_root, relative, local[relative])


def package_run(source, target, lock_path, local_cwd, command):
    validate_local_cwd(target, local_cwd)
    with open_lock(lock_path) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        sync_directory(source, target)
        baseline = tree_state(target)
        completed = subprocess.run(command, cwd=local_cwd, check=False)
        if completed.returncode != 0:
            return completed.returncode
        record_dependency_state(local_cwd, target)
        try:
            commit_local_changes(source, target, baseline)
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            return PACKAGE_CONFLICT_EXIT
    return 0


def validate_local_cwd(target, local_cwd):
    normalized_target = os.path.realpath(target)
    normalized_cwd = os.path.realpath(local_cwd)
    if os.path.commonpath([normalized_target, normalized_cwd]) != normalized_target:
        raise ValueError("package cwd must be inside the local project mirror")


def files_equal(left, right):
    return (
        os.path.isfile(left)
        and os.path.isfile(right)
        and os.path.getsize(left) == os.path.getsize(right)
        and file_digest(left) == file_digest(right)
    )


def dependency_state(local_cwd, local_root):
    digest = hashlib.sha256()
    current = os.path.realpath(local_cwd)
    root = os.path.realpath(local_root)
    while True:
        relative = os.path.relpath(current, root)
        for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"):
            path = os.path.join(current, name)
            digest.update(os.path.join(relative, name).encode("utf-8"))
            digest.update(b"\0")
            digest.update(file_digest(path).encode("ascii") if os.path.isfile(path) else b"missing")
            digest.update(b"\0")
        if current == root:
            return digest.hexdigest()
        current = os.path.dirname(current)


def dependency_state_path(local_cwd):
    return os.path.join(local_cwd, "node_modules", DEPENDENCY_STATE_FILENAME)


def dependencies_are_current(local_cwd, local_root):
    marker = dependency_state_path(local_cwd)
    try:
        with open(marker, "r", encoding="ascii") as source:
            return source.read().strip() == dependency_state(local_cwd, local_root)
    except (FileNotFoundError, OSError, UnicodeError):
        return False


def record_dependency_state(local_cwd, local_root):
    modules = os.path.join(local_cwd, "node_modules")
    if not os.path.isdir(modules):
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".cheatcode-dependency-", dir=modules)
    try:
        with os.fdopen(descriptor, "w", encoding="ascii") as target:
            target.write(dependency_state(local_cwd, local_root) + "\n")
        os.replace(temporary, dependency_state_path(local_cwd))
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def restore_pnpm_dependencies(local_cwd, local_root, dependency_template):
    package_path = os.path.join(local_cwd, "package.json")
    lock_path = os.path.join(local_cwd, "pnpm-lock.yaml")
    if not os.path.isfile(package_path):
        return 0
    if dependency_template and files_equal(
        package_path, os.path.join(dependency_template, "package.json")
    ) and files_equal(lock_path, os.path.join(dependency_template, "pnpm-lock.yaml")):
        return 0
    if dependencies_are_current(local_cwd, local_root):
        return 0
    common = ["install", "--prefer-offline", "--network-concurrency", "4"]
    if not os.path.isfile(lock_path):
        status = subprocess.run(
            ["pnpm", *common, "--lockfile=false"], cwd=local_cwd, check=False
        ).returncode
        if status == 0:
            record_dependency_state(local_cwd, local_root)
        return status
    offline = subprocess.run(
        ["pnpm", "install", "--frozen-lockfile", "--offline"],
        cwd=local_cwd,
        check=False,
    )
    if offline.returncode == 0:
        record_dependency_state(local_cwd, local_root)
        return 0
    status = subprocess.run(
        ["pnpm", "install", "--frozen-lockfile", *common[1:]],
        cwd=local_cwd,
        check=False,
    ).returncode
    if status == 0:
        record_dependency_state(local_cwd, local_root)
    return status


def stop_process(process):
    if process and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError:
            process.terminate()


def reap_process(process):
    if not process:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            process.kill()
        process.wait()


def preview_run(source, target, lock_path, local_cwd, dependency_template, command):
    validate_local_cwd(target, local_cwd)
    if not command:
        raise ValueError("preview-run requires an app command")
    with open_lock(lock_path) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        sync_directory(source, target)
        dependency_status = restore_pnpm_dependencies(local_cwd, target, dependency_template)
        if dependency_status != 0:
            return dependency_status

    sync_process = subprocess.Popen(
        [sys.executable, os.path.realpath(__file__), "preview-loop", source, target, lock_path],
        start_new_session=True,
    )
    app_process = None
    previous_handlers = {}

    def terminate_children(_signum=None, _frame=None):
        stop_process(app_process)
        stop_process(sync_process)

    try:
        for signal_number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            previous_handlers[signal_number] = signal.signal(signal_number, terminate_children)
        app_process = subprocess.Popen(command, cwd=local_cwd, start_new_session=True)
        return app_process.wait()
    finally:
        terminate_children()
        reap_process(app_process)
        reap_process(sync_process)
        for signal_number, handler in previous_handlers.items():
            signal.signal(signal_number, handler)


def main():
    if len(sys.argv) < 5:
        raise ValueError("missing local source synchronization arguments")
    mode, source, target, lock_path = sys.argv[1:5]
    if mode in {"preview-once", "preview-loop"}:
        preview_sync(source, target, mode, lock_path)
        return
    if mode == "package-run":
        if len(sys.argv) < 8 or sys.argv[6] != "--":
            raise ValueError("package-run requires a cwd and argv after --")
        raise SystemExit(package_run(source, target, lock_path, sys.argv[5], sys.argv[7:]))
    if mode == "preview-run":
        if len(sys.argv) < 9 or sys.argv[7] != "--":
            raise ValueError("preview-run requires a cwd, dependency template, and argv after --")
        dependency_template = None if sys.argv[6] == "-" else sys.argv[6]
        raise SystemExit(
            preview_run(
                source,
                target,
                lock_path,
                sys.argv[5],
                dependency_template,
                sys.argv[8:],
            )
        )
    raise ValueError("unknown local source synchronization mode")


if __name__ == "__main__":
    main()
