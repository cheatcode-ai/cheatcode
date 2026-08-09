#!/usr/bin/env python3
"""Synchronize durable project source with its sandbox-local native-disk mirror."""

import hashlib
import json
import os
import shutil
import sys
import time


IGNORED_DIRS = {".expo", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "out"}
LOCAL_ONLY_NAMES = IGNORED_DIRS | {"next-env.d.ts"}
LOCK_STALE_SECONDS = 15 * 60


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


def sync_file(source, target, force):
    source_stat = os.stat(source, follow_symlinks=False)
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
        shutil.copyfile(source, target, follow_symlinks=False)


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
                sync_file(entry.path, destination, force)
        except FileNotFoundError:
            continue
    for entry in os.scandir(target):
        if entry.name not in source_names and entry.name not in LOCAL_ONLY_NAMES:
            remove_path(entry.path)


def digest(path):
    value = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


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
            if os.path.islink(path):
                state[relative] = ["link", os.readlink(path)]
            else:
                state[relative] = ["dir"]
        for name in sorted(file_names):
            if name in LOCAL_ONLY_NAMES:
                continue
            path = os.path.join(current, name)
            relative = os.path.normpath(os.path.join(relative_root, name))
            if os.path.islink(path):
                state[relative] = ["link", os.readlink(path)]
            else:
                state[relative] = ["file", digest(path)]
    return state


def package_lock_active(lock_path):
    try:
        age = time.time() - os.path.getmtime(lock_path)
    except FileNotFoundError:
        return False
    if age <= LOCK_STALE_SECONDS:
        return True
    try:
        os.unlink(lock_path)
    except FileNotFoundError:
        pass
    return False


def wait_for_preview(lock_path, busy_path):
    deadline = time.time() + 30
    while os.path.exists(busy_path):
        if time.time() >= deadline:
            raise TimeoutError("local source mirror did not quiesce")
        time.sleep(0.05)


def preview_sync(source, target, mode, lock_path, busy_path):
    force = mode == "preview-once"
    while True:
        if package_lock_active(lock_path):
            if force:
                time.sleep(0.05)
                continue
            time.sleep(0.25)
            continue
        os.makedirs(os.path.dirname(busy_path), exist_ok=True)
        with open(busy_path, "w", encoding="utf-8"):
            pass
        try:
            if package_lock_active(lock_path):
                continue
            sync_directory(source, target, force)
        finally:
            try:
                os.unlink(busy_path)
            except FileNotFoundError:
                pass
        if force:
            return
        time.sleep(0.75)


def prepare(source, target, lock_path, busy_path, baseline_path):
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with open(lock_path, "w", encoding="utf-8") as lock:
        lock.write(str(time.time()))
    try:
        wait_for_preview(lock_path, busy_path)
        sync_directory(source, target, True)
        with open(baseline_path, "w", encoding="utf-8") as baseline:
            json.dump(tree_state(target), baseline, sort_keys=True, separators=(",", ":"))
    except Exception:
        cleanup(lock_path, baseline_path)
        raise


def copy_state(source_root, target_root, relative, state):
    source = os.path.join(source_root, relative)
    target = os.path.join(target_root, relative)
    kind = state[0]
    if kind == "dir":
        if os.path.lexists(target) and not os.path.isdir(target):
            remove_path(target)
        os.makedirs(target, exist_ok=True)
        return
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if kind == "link":
        sync_link(source, target)
        return
    if os.path.isdir(target) or os.path.islink(target):
        remove_path(target)
    shutil.copyfile(source, target, follow_symlinks=False)


def cleanup(lock_path, baseline_path):
    for path in (baseline_path, lock_path):
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def commit(source, target, lock_path, baseline_path):
    try:
        with open(baseline_path, encoding="utf-8") as baseline_file:
            baseline = json.load(baseline_file)
        local = tree_state(target)
        durable = tree_state(source)
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
            remove_path(os.path.join(source, relative))
        for relative in sorted(
            (path for path in changed if path in local),
            key=lambda value: value.count(os.sep),
        ):
            copy_state(target, source, relative, local[relative])
    finally:
        cleanup(lock_path, baseline_path)


def main():
    mode, source, target, lock_path, busy_path, baseline_path = sys.argv[1:7]
    if mode in {"preview-once", "preview-loop"}:
        preview_sync(source, target, mode, lock_path, busy_path)
    elif mode == "package-prepare":
        prepare(source, target, lock_path, busy_path, baseline_path)
    elif mode == "package-commit":
        commit(source, target, lock_path, baseline_path)
    elif mode == "package-abort":
        cleanup(lock_path, baseline_path)
    else:
        raise ValueError("unknown local source synchronization mode")


if __name__ == "__main__":
    main()
