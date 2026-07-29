import { shellQuote } from "../sandbox-support";

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

export function clearWorkspaceCommand(): string {
  const encoded = btoa(JSON.stringify({}));
  return `python3 -c ${shellQuote(CLEAR_WORKSPACE_SCRIPT)} ${shellQuote(encoded)}`;
}
