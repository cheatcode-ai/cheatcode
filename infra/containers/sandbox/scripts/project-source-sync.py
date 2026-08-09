#!/usr/bin/env python3
"""Synchronize durable project source with its sandbox-local native-disk mirror."""

import fcntl
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time


IGNORED_DIRS = {".expo", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "out"}
LOCAL_ONLY_NAMES = IGNORED_DIRS | {"next-env.d.ts"}
PACKAGE_CONFLICT_EXIT = 74


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


def atomic_copy(source, target):
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


def sync_link(source, target):
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
    atomic_copy(source, target)


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
                sync_link(entry.path, destination)
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


def copy_state(source_root, target_root, relative, state):
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
        sync_link(source, target)
        return
    if os.path.isdir(target) or os.path.islink(target):
        remove_path(target)
    atomic_copy(source, target)


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
        copy_state(local_root, durable_root, relative, local[relative])


def package_run(source, target, lock_path, local_cwd, command):
    normalized_target = os.path.realpath(target)
    normalized_cwd = os.path.realpath(local_cwd)
    if os.path.commonpath([normalized_target, normalized_cwd]) != normalized_target:
        raise ValueError("package cwd must be inside the local project mirror")
    with open_lock(lock_path) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        sync_directory(source, target)
        baseline = tree_state(target)
        completed = subprocess.run(command, cwd=local_cwd, check=False)
        if completed.returncode != 0:
            return completed.returncode
        try:
            commit_local_changes(source, target, baseline)
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            return PACKAGE_CONFLICT_EXIT
    return 0


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
    raise ValueError("unknown local source synchronization mode")


if __name__ == "__main__":
    main()
