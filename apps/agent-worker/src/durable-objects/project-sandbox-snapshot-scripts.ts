import { shellQuote } from "./project-sandbox-process-support";

export const SNAPSHOT_TRANSFER_CHUNK_BYTES = 8 * 1024 * 1024;

export function prepareWorkspaceArchiveCommand(upgradeId: string): string {
  return pythonCommand(PREPARE_WORKSPACE_ARCHIVE_SCRIPT, {
    chunkBytes: SNAPSHOT_TRANSFER_CHUNK_BYTES,
    upgradeId,
  });
}

export function verifyWorkspaceArchiveCommand(input: {
  archiveDigest: string;
  archiveSize: number;
  chunkCount: number;
  treeDigest: string;
  upgradeId: string;
}): string {
  return pythonCommand(VERIFY_WORKSPACE_ARCHIVE_SCRIPT, input);
}

export function digestWorkspaceCommand(): string {
  return pythonCommand(DIGEST_WORKSPACE_SCRIPT, {});
}

export function verifyTransferChunkCommand(input: {
  digest: string;
  path: string;
  size: number;
}): string {
  return pythonCommand(VERIFY_TRANSFER_CHUNK_SCRIPT, input);
}

export function clearWorkspaceCommand(): string {
  return pythonCommand(CLEAR_WORKSPACE_SCRIPT, {});
}

function pythonCommand(script: string, payload: unknown): string {
  const encoded = btoa(JSON.stringify(payload));
  return `python3 -c ${shellQuote(script)} ${shellQuote(encoded)}`;
}

const TREE_DIGEST_FUNCTIONS = `
def raise_walk_error(error):
    raise error

def tree_entries(root):
    values = []
    for current, directories, files in os.walk(root, topdown=True, onerror=raise_walk_error, followlinks=False):
        directories.sort()
        files.sort()
        for name in directories + files:
            path = os.path.join(current, name)
            relative = os.path.relpath(path, root).replace(os.sep, "/")
            values.append((relative, path))
    values.sort(key=lambda value: value[0])
    return values

def tree_digest(root):
    digest = hashlib.sha256()
    for relative, path in tree_entries(root):
        metadata = os.lstat(path)
        mode = stat.S_IMODE(metadata.st_mode)
        if stat.S_ISDIR(metadata.st_mode):
            header = [relative, "directory", mode]
        elif stat.S_ISREG(metadata.st_mode):
            header = [relative, "file", mode, metadata.st_size]
        elif stat.S_ISLNK(metadata.st_mode):
            header = [relative, "symlink", mode, os.readlink(path)]
        else:
            raise RuntimeError(f"Unsupported workspace entry: {relative}")
        encoded = json.dumps(header, ensure_ascii=True, separators=(",", ":")).encode("ascii")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        if stat.S_ISREG(metadata.st_mode):
            with open(path, "rb") as source:
                while True:
                    block = source.read(1024 * 1024)
                    if not block:
                        break
                    digest.update(block)
    return digest.hexdigest()
`;

const PREPARE_WORKSPACE_ARCHIVE_SCRIPT = `
import base64
import hashlib
import json
import os
import shutil
import stat
import sys
import tarfile

${TREE_DIGEST_FUNCTIONS}

payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
upgrade_id = payload["upgradeId"]
chunk_bytes = payload["chunkBytes"]
if not isinstance(upgrade_id, str) or len(upgrade_id) != 32 or any(c not in "0123456789abcdef" for c in upgrade_id):
    raise RuntimeError("Invalid snapshot upgrade identity")
if not isinstance(chunk_bytes, int) or chunk_bytes < 1:
    raise RuntimeError("Invalid snapshot transfer chunk size")

root = "/workspace"
base = f"/tmp/cheatcode-snapshot-upgrade/{upgrade_id}"
chunks_path = os.path.join(base, "chunks")
os.makedirs(root, exist_ok=True)
shutil.rmtree(base, ignore_errors=True)
os.makedirs(chunks_path, mode=0o700)

class ChunkWriter:
    def __init__(self, directory, chunk_size):
        self.archive_digest = hashlib.sha256()
        self.archive_size = 0
        self.chunk_count = 0
        self.chunk_size = chunk_size
        self.current = None
        self.current_size = 0
        self.directory = directory

    def write(self, data):
        view = memoryview(data)
        total = len(view)
        while view:
            if self.current is None:
                path = os.path.join(self.directory, f"chunk-{self.chunk_count:012d}")
                self.current = open(path, "wb")
                self.current_size = 0
                self.chunk_count += 1
            take = min(len(view), self.chunk_size - self.current_size)
            block = view[:take]
            self.current.write(block)
            self.archive_digest.update(block)
            self.archive_size += take
            self.current_size += take
            view = view[take:]
            if self.current_size == self.chunk_size:
                self.current.close()
                self.current = None
        return total

    def flush(self):
        if self.current is not None:
            self.current.flush()

    def close(self):
        if self.current is not None:
            self.current.close()
            self.current = None

digest = tree_digest(root)
writer = ChunkWriter(chunks_path, chunk_bytes)
with tarfile.open(fileobj=writer, mode="w|", dereference=False) as archive:
    for relative, path in tree_entries(root):
        archive.add(path, arcname=relative, recursive=False)
writer.close()

print(json.dumps({
    "archiveDigest": writer.archive_digest.hexdigest(),
    "archiveSize": writer.archive_size,
    "chunkCount": writer.chunk_count,
    "treeDigest": digest,
}, separators=(",", ":")))
`;

const DIGEST_WORKSPACE_SCRIPT = `
import base64
import hashlib
import json
import os
import stat
import sys

${TREE_DIGEST_FUNCTIONS}

json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
os.makedirs("/workspace", exist_ok=True)
print(json.dumps({"treeDigest": tree_digest("/workspace")}, separators=(",", ":")))
`;

const VERIFY_TRANSFER_CHUNK_SCRIPT = `
import base64
import hashlib
import json
import os
import sys

payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
path = payload["path"]
if not isinstance(path, str) or not path.startswith("/tmp/cheatcode-snapshot-upgrade/"):
    raise RuntimeError("Invalid snapshot transfer path")
digest = hashlib.sha256()
size = 0
with open(path, "rb") as source:
    while True:
        block = source.read(1024 * 1024)
        if not block:
            break
        digest.update(block)
        size += len(block)
verified = size == payload["size"] and digest.hexdigest() == payload["digest"]
print(json.dumps({"verified": verified}, separators=(",", ":")))
raise SystemExit(0 if verified else 4)
`;

const CLEAR_WORKSPACE_SCRIPT = `
import base64
import json
import os
import shutil

json.loads(base64.b64decode(__import__("sys").argv[1]).decode("utf-8"))
root = "/workspace"
os.makedirs(root, exist_ok=True)
for name in os.listdir(root):
    path = os.path.join(root, name)
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    else:
        os.unlink(path)
print(json.dumps({"cleared": True}, separators=(",", ":")))
`;

const VERIFY_WORKSPACE_ARCHIVE_SCRIPT = `
import base64
import hashlib
import json
import os
from pathlib import PurePosixPath
import shutil
import sqlite3
import stat
import sys
import tarfile

${TREE_DIGEST_FUNCTIONS}

payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
upgrade_id = payload["upgradeId"]
if not isinstance(upgrade_id, str) or len(upgrade_id) != 32 or any(c not in "0123456789abcdef" for c in upgrade_id):
    raise RuntimeError("Invalid snapshot upgrade identity")
base = f"/tmp/cheatcode-snapshot-upgrade/{upgrade_id}"
chunks_path = os.path.join(base, "chunks")
directory_modes_path = os.path.join(base, "directory-modes.sqlite")

def retry_transfer(reason):
    print(json.dumps({"reason": reason, "retryTransfer": True}, separators=(",", ":")))
    raise SystemExit(3)

archive_digest = hashlib.sha256()
archive_size = 0
try:
    for index in range(payload["chunkCount"]):
        chunk_path = os.path.join(chunks_path, f"chunk-{index:012d}")
        with open(chunk_path, "rb") as source:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                archive_digest.update(block)
                archive_size += len(block)
except FileNotFoundError:
    retry_transfer("missing chunk")

if archive_size != payload["archiveSize"] or archive_digest.hexdigest() != payload["archiveDigest"]:
    retry_transfer("archive digest mismatch")

def safe_relative(value):
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        raise RuntimeError(f"Unsafe archive path: {value}")
    return path

def validate_link(member):
    if not (member.issym() or member.islnk()):
        return
    link = PurePosixPath(member.linkname)
    if link.is_absolute():
        raise RuntimeError(f"Absolute archive link: {member.name}")
    combined = link if member.islnk() else PurePosixPath(member.name).parent / link
    depth = 0
    for part in combined.parts:
        if part in ("", "."):
            continue
        if part == "..":
            depth -= 1
        else:
            depth += 1
        if depth < 0:
            raise RuntimeError(f"Escaping archive link: {member.name}")

class ChunkReader:
    def __init__(self, directory, count):
        self.count = count
        self.current = None
        self.directory = directory
        self.index = 0

    def read(self, size=-1):
        if size is None or size < 0:
            size = 1024 * 1024
        output = bytearray()
        while len(output) < size and self.index < self.count:
            if self.current is None:
                path = os.path.join(self.directory, f"chunk-{self.index:012d}")
                self.current = open(path, "rb")
            block = self.current.read(size - len(output))
            if block:
                output.extend(block)
                continue
            self.current.close()
            self.current = None
            self.index += 1
        return bytes(output)

    def close(self):
        if self.current is not None:
            self.current.close()
            self.current = None

def target_path(relative):
    parts = safe_relative(relative).parts
    current = root
    for part in parts[:-1]:
        current = os.path.join(current, part)
        if os.path.lexists(current):
            metadata = os.lstat(current)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise RuntimeError(f"Unsafe archive parent: {relative}")
        else:
            os.mkdir(current, mode=0o700)
    return os.path.join(root, *parts)

root = "/workspace"
os.makedirs(root, exist_ok=True)
for name in os.listdir(root):
    path = os.path.join(root, name)
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    else:
        os.unlink(path)

if os.path.exists(directory_modes_path):
    os.unlink(directory_modes_path)
directory_modes = sqlite3.connect(directory_modes_path)
directory_modes.execute("CREATE TABLE modes (path TEXT PRIMARY KEY, mode INTEGER NOT NULL)")
reader = ChunkReader(chunks_path, payload["chunkCount"])
with tarfile.open(fileobj=reader, mode="r|") as archive:
    for member in archive:
        safe_relative(member.name)
        validate_link(member)
        if not (member.isdir() or member.isreg() or member.issym() or member.islnk()):
            raise RuntimeError(f"Unsupported archive member: {member.name}")
        target = target_path(member.name)
        if member.isdir():
            if os.path.lexists(target) and not os.path.isdir(target):
                raise RuntimeError(f"Archive directory collides with a file: {member.name}")
            os.makedirs(target, mode=0o700, exist_ok=True)
            os.chmod(target, 0o700)
            directory_modes.execute("INSERT INTO modes (path, mode) VALUES (?, ?)", (target, member.mode))
        elif member.issym():
            if os.path.lexists(target):
                raise RuntimeError(f"Archive symlink destination exists: {member.name}")
            os.symlink(member.linkname, target)
        elif member.islnk():
            source_path = target_path(member.linkname)
            if not os.path.isfile(source_path) or os.path.islink(source_path):
                raise RuntimeError(f"Archive hardlink source is unavailable: {member.name}")
            with open(source_path, "rb") as source, open(target, "xb") as destination:
                shutil.copyfileobj(source, destination, 1024 * 1024)
            os.chmod(target, member.mode)
        else:
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError(f"Archive file has no payload: {member.name}")
            with source, open(target, "xb") as destination:
                shutil.copyfileobj(source, destination, 1024 * 1024)
            os.chmod(target, member.mode)
reader.close()
directory_modes.commit()
for target, mode in directory_modes.execute("SELECT path, mode FROM modes ORDER BY length(path) DESC"):
    os.chmod(target, mode)
directory_modes.close()
os.unlink(directory_modes_path)

verified_tree = tree_digest(root)
if verified_tree != payload["treeDigest"]:
    print(json.dumps({"reason": "workspace digest mismatch", "retryTransfer": False}, separators=(",", ":")))
    raise SystemExit(4)
print(json.dumps({
    "archiveDigest": archive_digest.hexdigest(),
    "retryTransfer": False,
    "treeDigest": verified_tree,
}, separators=(",", ":")))
`;
