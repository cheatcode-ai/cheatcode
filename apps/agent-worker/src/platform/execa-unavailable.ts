function throwUnavailable(): never {
  throw new Error("Local process execution is unavailable in the Cloudflare Worker runtime");
}

export const $ = throwUnavailable;
export const execa = throwUnavailable;
export const execaCommand = throwUnavailable;
export const execaCommandSync = throwUnavailable;
export const execaNode = throwUnavailable;
export const execaSync = throwUnavailable;
