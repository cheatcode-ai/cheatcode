import { randomBytes } from "node:crypto";

const INTERCEPTED_TARGET_TYPES = new Set([
  "iframe",
  "page",
]);
const AUXILIARY_NETWORK_TARGET_TYPES = new Set([
  "background_page",
  "service_worker",
  "shared_worker",
  "worker",
  "worklet",
]);
const CONNECTION_GUARD_KEY = "__cheatcodeBrowserOriginGuard";
const CONNECTION_GUARD_TOKEN = randomBytes(32).toString("base64url");
const CONNECTION_GUARD_SOURCE = `(() => {
  const key = ${JSON.stringify(CONNECTION_GUARD_KEY)};
  const expectedToken = ${JSON.stringify(CONNECTION_GUARD_TOKEN)};
  if (globalThis[key]?.version === 1) return;
  const state = { active: false, connections: new Set(), origins: new Set(), peers: new Set() };
  const isAllowed = (value) => {
    if (!state.active) return true;
    try { return state.origins.has(new URL(String(value), location.href).origin); }
    catch { return false; }
  };
  const closeConnection = (entry) => {
    try { entry.connection.close(); } catch {}
    state.connections.delete(entry);
  };
  const wrapUrlConnection = (name) => {
    const Native = globalThis[name];
    if (typeof Native !== "function") return;
    const Wrapped = new Proxy(Native, {
      construct(target, args) {
        const url = String(args[0] ?? "");
        if (!isAllowed(url)) throw new DOMException("Network origin is blocked", "SecurityError");
        const connection = Reflect.construct(target, args);
        const entry = { connection, url };
        state.connections.add(entry);
        connection.addEventListener?.("close", () => state.connections.delete(entry), { once: true });
        void connection.closed?.then?.(
          () => state.connections.delete(entry),
          () => state.connections.delete(entry),
        );
        return connection;
      },
    });
    Object.defineProperty(Native.prototype, "constructor", {
      configurable: false, value: Wrapped, writable: false,
    });
    Object.defineProperty(globalThis, name, {
      configurable: false, value: Wrapped, writable: false,
    });
  };
  for (const name of ["EventSource", "WebSocket", "WebTransport"]) wrapUrlConnection(name);
  const peerWrappers = new Map();
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
    const NativePeer = globalThis[name];
    if (typeof NativePeer !== "function") continue;
    let WrappedPeer = peerWrappers.get(NativePeer);
    if (!WrappedPeer) {
      WrappedPeer = new Proxy(NativePeer, {
        construct(target, args) {
          if (state.active) throw new DOMException("Peer connections are blocked", "SecurityError");
          const peer = Reflect.construct(target, args);
          state.peers.add(peer);
          const close = peer.close.bind(peer);
          peer.close = () => { state.peers.delete(peer); return close(); };
          return peer;
        },
      });
      peerWrappers.set(NativePeer, WrappedPeer);
      Object.defineProperty(NativePeer.prototype, "constructor", {
        configurable: false, value: WrappedPeer, writable: false,
      });
    }
    Object.defineProperty(globalThis, name, {
      configurable: false, value: WrappedPeer, writable: false,
    });
  }
  const api = Object.freeze({
    version: 1,
    activate(candidateToken, origins) {
      if (candidateToken !== expectedToken || !Array.isArray(origins)) return false;
      state.origins = new Set(origins);
      state.active = true;
      for (const entry of [...state.connections]) if (!isAllowed(entry.url)) closeConnection(entry);
      for (const peer of [...state.peers]) { try { peer.close(); } catch {} state.peers.delete(peer); }
      return true;
    },
    deactivate(candidateToken) {
      if (candidateToken !== expectedToken) return false;
      state.active = false;
      state.origins.clear();
      return true;
    },
  });
  Object.defineProperty(globalThis, key, {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})()`;

/** Installs connection tracking before any user page is allowed to navigate. */
export async function installBrowserConnectionGuard(context) {
  await context.addInitScript(CONNECTION_GUARD_SOURCE);
  const sessions = currentPageSessions(context);
  const installations = await Promise.all(
    sessions.map((session) =>
      session.send("Page.addScriptToEvaluateOnNewDocument", {
        runImmediately: true,
        source: CONNECTION_GUARD_SOURCE,
      }),
    ),
  );
  await Promise.all(
    sessions.map((session, index) =>
      session.send("Page.removeScriptToEvaluateOnNewDocument", {
        identifier: installations[index].identifier,
      }),
    ),
  );
}

/** Applies exact-origin egress policy to all current and newly attached browser targets. */
export async function installOriginInterceptor(stagehand, allowedOrigin) {
  const context = stagehand.context;
  const policy = createOriginPolicy(allowedOrigin);
  const registry = createOriginInterceptorRegistry(context, policy);
  context.conn.on("Target.attachedToTarget", registry.onAttached);
  const controller = originInterceptorController(
    context.conn,
    registry.interceptors,
    registry.setups,
    registry.onAttached,
    registry.getFailure,
  );
  try {
    await ensureContextAutoAttach(context.conn);
    await isolateExistingTargets(context, registry.isolateTarget);
    registerPageSessions(context, registry.register);
    await controller.assertHealthy();
    await verifyPageConnectionGuards(context, policy);
    await controller.assertHealthy();
    return controller;
  } catch (error) {
    await controller.close();
    throw error;
  }
}

function createOriginInterceptorRegistry(context, policy) {
  const interceptors = new Map();
  const isolatedTargets = new Map();
  const setups = new Set();
  let failure;
  const recordFailure = (error) => {
    failure ??= error;
  };
  const trackSetup = (operation) => {
    const setup = operation.catch(recordFailure);
    setups.add(setup);
    void setup.then(() => setups.delete(setup));
    return setup;
  };
  const isolateTarget = (targetId) => {
    const existing = isolatedTargets.get(targetId);
    if (existing) return existing;
    const isolation = trackSetup(closeAttachedTarget(context.conn, targetId));
    isolatedTargets.set(targetId, isolation);
    return isolation;
  };
  const register = (session) => {
    if (!session?.id || interceptors.has(session.id)) return;
    const interceptor = createTargetInterceptor(session, policy, recordFailure);
    interceptors.set(session.id, interceptor);
    trackSetup(interceptor.enable());
  };
  const onAttached = (event) =>
    handleAttachedTarget({ context, event, isolateTarget, recordFailure, register });
  return {
    getFailure: () => failure,
    interceptors,
    isolateTarget,
    onAttached,
    register,
    setups,
  };
}

function handleAttachedTarget({ context, event, isolateTarget, recordFailure, register }) {
  if (!isRecord(event.targetInfo) || typeof event.targetInfo.targetId !== "string") {
    recordFailure(new Error("Attached browser target is invalid"));
    return;
  }
  if (!isInterceptedTarget(event.targetInfo)) {
    isolateTarget(event.targetInfo.targetId);
    if (!isAuxiliaryNetworkTarget(event.targetInfo)) {
      recordFailure(new Error("Unknown browser target was isolated"));
    }
    return;
  }
  const session = context.conn.getSession(event.sessionId);
  if (session) {
    register(session);
    return;
  }
  isolateTarget(event.targetInfo.targetId);
  recordFailure(new Error("Attached browser target is missing"));
}

function originInterceptorController(conn, interceptors, setups, onAttached, getFailure) {
  return {
    assertHealthy: async () => {
      while (setups.size > 0) await Promise.all([...setups]);
      await Promise.all([...interceptors.values()].map((interceptor) => interceptor.settle()));
      if (getFailure()) throw new Error("Browser origin interception failed");
    },
    close: async () => {
      conn.off("Target.attachedToTarget", onAttached);
      while (setups.size > 0) await Promise.all([...setups]);
      await Promise.all([...interceptors.values()].map((interceptor) => interceptor.close()));
      if (getFailure()) throw new Error("Browser origin interception failed");
    },
  };
}

async function ensureContextAutoAttach(conn) {
  await conn.send("Target.setAutoAttach", {
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: true,
  });
}

function registerPageSessions(context, register) {
  for (const session of currentPageSessions(context)) register(session);
}

function currentPageSessions(context) {
  const sessions = new Map();
  for (const page of context.pages()) {
    const frameIds = new Set([page.mainFrameId(), ...page.listAllFrameIds()]);
    for (const frameId of frameIds) {
      const session = page.getSessionForFrame(frameId);
      if (session?.id) sessions.set(session.id, session);
    }
  }
  return [...sessions.values()];
}

async function verifyPageConnectionGuards(context, policy) {
  const input = {
    key: CONNECTION_GUARD_KEY,
    origins: [...policy.allowedOrigins],
    token: CONNECTION_GUARD_TOKEN,
  };
  const checks = [];
  for (const page of context.pages()) {
    for (const frameId of new Set([page.mainFrameId(), ...page.listAllFrameIds()])) {
      checks.push(
        page
          .frameForId(frameId)
          .evaluate(
            ({ key, origins, token }) => globalThis[key]?.activate(token, origins) === true,
            input,
          ),
      );
    }
  }
  if ((await Promise.all(checks)).some((isActive) => !isActive)) {
    throw new Error("Browser page connection guard could not be activated");
  }
}

async function isolateExistingTargets(context, isolateTarget) {
  const topLevelTargetIds = new Set(context.pages().map((page) => page.targetId()));
  const targets = await context.conn.getTargets();
  const isolatedTargets = targets.filter(
    (target) =>
      !isInterceptedTarget(target) ||
      (target.type === "page" && !topLevelTargetIds.has(target.targetId)),
  );
  await Promise.all(isolatedTargets.map((target) => isolateTarget(target.targetId)));
  if (isolatedTargets.some((target) => !isAuxiliaryNetworkTarget(target))) {
    throw new Error("Unknown browser target was isolated");
  }
}

async function closeAttachedTarget(conn, targetId) {
  const result = await conn.send("Target.closeTarget", { targetId });
  if (result.success !== true) {
    throw new Error("Browser target could not be isolated");
  }
}

function createTargetInterceptor(session, policy, recordFailure) {
  const pending = new Set();
  let activationScriptId;
  const track = (operation) => {
    const tracked = operation.catch(recordFailure);
    pending.add(tracked);
    void tracked.then(() => pending.delete(tracked));
  };
  const onRequestPaused = (event) => track(continueOrBlockRequest(session, event, policy));
  const onWebSocketCreated = (event) => assertTransportOrigin(event.url, policy, recordFailure);
  const onWebTransportCreated = (event) => assertTransportOrigin(event.url, policy, recordFailure);
  session.on("Fetch.requestPaused", onRequestPaused);
  session.on("Network.webSocketCreated", onWebSocketCreated);
  session.on("Network.webTransportCreated", onWebTransportCreated);
  return {
    enable: async () => {
      activationScriptId = await enableTargetPolicy(session, policy);
    },
    settle: async () => {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    close: async () => {
      await disableTargetPolicy(session, activationScriptId);
      session.off("Fetch.requestPaused", onRequestPaused);
      session.off("Network.webSocketCreated", onWebSocketCreated);
      session.off("Network.webTransportCreated", onWebTransportCreated);
      await Promise.all([...pending]);
    },
  };
}

async function enableTargetPolicy(session, policy) {
  const activation = session.send("Page.addScriptToEvaluateOnNewDocument", {
    runImmediately: true,
    source: connectionGuardActivationSource(policy),
  });
  // Stagehand 3.7.0 pauses auto-attached targets. These calls are queued on the
  // same CDP transport before the resume command, so no target runs first-party
  // code before its exact-origin policy and recursive auto-attach are installed.
  const results = await Promise.all([
    session.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: true,
    }),
    session.send("Network.enable"),
    session.send("Network.setBypassServiceWorker", { bypass: true }),
    session.send("Network.setBlockedURLs", { urlPatterns: policy.blockPatterns }),
    session.send("Fetch.enable", { patterns: policy.fetchPatterns }),
    activation,
    session.send("Runtime.runIfWaitingForDebugger"),
  ]);
  return results[5]?.identifier;
}

async function disableTargetPolicy(session, activationScriptId) {
  const deactivation = deactivatePageConnectionGuard(session, activationScriptId);
  // Stagehand owns recursive target auto-attach for the context lifetime. Leave
  // it enabled so removing this action-scoped listener cannot wedge later pages.
  await Promise.allSettled([
    session.send("Fetch.disable"),
    session.send("Network.setBlockedURLs", { urlPatterns: [] }),
    session.send("Network.setBypassServiceWorker", { bypass: false }),
    deactivation,
  ]);
}

async function deactivatePageConnectionGuard(session, activationScriptId) {
  const installed = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    runImmediately: true,
    source: `globalThis[${JSON.stringify(CONNECTION_GUARD_KEY)}]?.deactivate(${JSON.stringify(CONNECTION_GUARD_TOKEN)})`,
  });
  const removals = [installed.identifier, activationScriptId]
    .filter(Boolean)
    .map((identifier) => session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }));
  await Promise.allSettled(removals);
}

async function continueOrBlockRequest(session, event, policy) {
  const requestId = event.requestId;
  if (typeof requestId !== "string" || !isRecord(event.request)) {
    throw new Error("Browser request interception event is invalid");
  }
  const url = event.request.url;
  const isAllowed = typeof url === "string" && policy.allowedOrigins.has(networkOrigin(url));
  await session.send(isAllowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
    ...(isAllowed ? {} : { errorReason: "BlockedByClient" }),
    requestId,
  });
}

function createOriginPolicy(allowedOrigin) {
  const httpUrl = new URL(allowedOrigin);
  const socketUrl = new URL(allowedOrigin);
  socketUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  const allowedOrigins = new Set([httpUrl.origin, socketUrl.origin]);
  const allowedPatterns = [...allowedOrigins].map((origin) => ({
    block: false,
    urlPattern: `${origin}/*`,
  }));
  const blockedPatterns = ["http", "https", "ws", "wss"].map((scheme) => ({
    block: true,
    urlPattern: `${scheme}://*:*/*`,
  }));
  const fetchPatterns = ["http", "https", "ws", "wss"].map((scheme) => ({
    requestStage: "Request",
    urlPattern: `${scheme}://*/*`,
  }));
  return { allowedOrigins, blockPatterns: [...allowedPatterns, ...blockedPatterns], fetchPatterns };
}

function connectionGuardActivationSource(policy) {
  const origins = JSON.stringify([...policy.allowedOrigins]);
  const key = JSON.stringify(CONNECTION_GUARD_KEY);
  const token = JSON.stringify(CONNECTION_GUARD_TOKEN);
  return `${CONNECTION_GUARD_SOURCE};if(globalThis[${key}]?.activate(${token},${origins})!==true)throw new Error("Browser connection guard failed")`;
}

function assertTransportOrigin(value, policy, recordFailure) {
  if (typeof value !== "string" || !policy.allowedOrigins.has(networkOrigin(value))) {
    recordFailure(new Error("Browser transport crossed its bound origin"));
  }
}

function networkOrigin(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function isInterceptedTarget(value) {
  return isRecord(value) && INTERCEPTED_TARGET_TYPES.has(value.type);
}

function isAuxiliaryNetworkTarget(value) {
  return isRecord(value) && AUXILIARY_NETWORK_TARGET_TYPES.has(value.type);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
