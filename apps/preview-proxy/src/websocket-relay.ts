const CLOSE_CODE_EXPIRED = 4001;
const CLOSE_CODE_INTERNAL_ERROR = 1011;
const CLOSE_CODE_MESSAGE_TOO_LARGE = 1009;
const CLOSE_CODE_PROTOCOL_ERROR = 1002;
const CLOSE_REASON_EXPIRED = "Preview session expired";
const CLOSE_REASON_INTERNAL_ERROR = "Preview connection failed";
const CLOSE_REASON_MESSAGE_TOO_LARGE = "Preview message too large";
const CLOSE_REASON_PROTOCOL_ERROR = "Invalid upstream subprotocol";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_CLOSE_REASON_BYTES = 123;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;
const INVALID_CLOSE_CODES = new Set([1004, 1005, 1006, 1015]);
const PROTOCOL_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

interface RelaySockets {
  readonly client: WebSocket;
  readonly edge: WebSocket;
  readonly upstream: WebSocket;
}

/**
 * Relay an authenticated upstream socket through a Worker-owned pair. Keeping
 * the edge in the data path lets the signed preview session expire even when a
 * generated app holds its WebSocket open indefinitely.
 */
export function relayPreviewWebSocket(
  upstreamResponse: Response,
  sessionExpiresAt: number,
  requestedProtocolsHeader: string | null,
): Response {
  const upstream = upstreamResponse.webSocket;
  if (!upstream) {
    throw new Error("Cannot relay a response without an upstream WebSocket");
  }

  let protocol: string | null;
  try {
    protocol = validateSelectedProtocol(
      upstreamResponse.headers.get("Sec-WebSocket-Protocol"),
      requestedProtocolsHeader,
    );
  } catch (error) {
    rejectUpstreamHandshake(upstream);
    throw error;
  }
  const pair = new WebSocketPair();
  const sockets = { client: pair[0], edge: pair[1], upstream };
  const relay = new PreviewWebSocketRelay(sockets, sessionExpiresAt);
  relay.start();

  const headers = new Headers();
  if (protocol) {
    headers.set("Sec-WebSocket-Protocol", protocol);
  }
  return new Response(null, { headers, status: 101, webSocket: sockets.client });
}

class PreviewWebSocketRelay {
  private isFinished = false;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly sockets: RelaySockets,
    private readonly sessionExpiresAt: number,
  ) {}

  start(): void {
    const { edge, upstream } = this.sockets;
    edge.binaryType = "arraybuffer";
    upstream.binaryType = "arraybuffer";
    edge.addEventListener("message", (event) => this.forward(event, upstream));
    upstream.addEventListener("message", (event) => this.forward(event, edge));
    edge.addEventListener("close", (event) => this.closeFromPeer(event, edge, upstream));
    upstream.addEventListener("close", (event) => this.closeFromPeer(event, upstream, edge));
    edge.addEventListener("error", () =>
      this.finish(CLOSE_CODE_INTERNAL_ERROR, CLOSE_REASON_INTERNAL_ERROR),
    );
    upstream.addEventListener("error", () =>
      this.finish(CLOSE_CODE_INTERNAL_ERROR, CLOSE_REASON_INTERNAL_ERROR),
    );
    edge.accept({ allowHalfOpen: true });
    upstream.accept({ allowHalfOpen: true });
    this.expiryTimer = setTimeout(
      () => this.finish(CLOSE_CODE_EXPIRED, CLOSE_REASON_EXPIRED),
      Math.max(0, this.sessionExpiresAt - Date.now()),
    );
  }

  private finish(code: number, reason: string): void {
    if (this.isFinished) {
      return;
    }
    this.isFinished = true;
    this.clearExpiryTimer();
    closeIfActive(this.sockets.edge, code, reason);
    closeIfActive(this.sockets.upstream, code, reason);
  }

  private forward(event: MessageEvent, destination: WebSocket): void {
    if (this.isFinished) {
      return;
    }
    if (Date.now() >= this.sessionExpiresAt) {
      this.finish(CLOSE_CODE_EXPIRED, CLOSE_REASON_EXPIRED);
      return;
    }
    if (destination.readyState !== SOCKET_OPEN) {
      this.finish(CLOSE_CODE_INTERNAL_ERROR, CLOSE_REASON_INTERNAL_ERROR);
      return;
    }
    try {
      const data: unknown = event.data;
      if (typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        if (messageByteLength(data) > MAX_FRAME_BYTES) {
          this.finish(CLOSE_CODE_MESSAGE_TOO_LARGE, CLOSE_REASON_MESSAGE_TOO_LARGE);
          return;
        }
        destination.send(data);
        return;
      }
    } catch {
      // A failed send makes the bidirectional relay unusable; close both halves.
    }
    this.finish(CLOSE_CODE_INTERNAL_ERROR, CLOSE_REASON_INTERNAL_ERROR);
  }

  private closeFromPeer(event: CloseEvent, source: WebSocket, peer: WebSocket): void {
    if (this.isFinished) {
      return;
    }
    this.isFinished = true;
    this.clearExpiryTimer();
    const code = sanitizeCloseCode(event.code);
    const reason = sanitizeCloseReason(event.reason);
    // allowHalfOpen requires explicitly completing the close handshake on the
    // source as well as propagating it to the opposite half.
    closeIfActive(source, code, reason);
    closeIfActive(peer, code, reason);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== undefined) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }
}

function closeIfActive(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === SOCKET_CLOSED) {
    return;
  }
  try {
    socket.close(code, reason);
  } catch {
    // The peer can transition between the ready-state check and close().
  }
}

function sanitizeCloseCode(code: number): number {
  const isDefinedProtocolCode = code >= 1000 && code <= 1014;
  const isPrivateCode = code >= 3000 && code <= 4999;
  if ((isDefinedProtocolCode || isPrivateCode) && !INVALID_CLOSE_CODES.has(code)) {
    return code;
  }
  return CLOSE_CODE_INTERNAL_ERROR;
}

function sanitizeCloseReason(reason: string): string {
  let sanitized = "";
  for (const character of reason) {
    const candidate = sanitized + character;
    if (new TextEncoder().encode(candidate).byteLength > MAX_CLOSE_REASON_BYTES) {
      break;
    }
    sanitized = candidate;
  }
  return sanitized;
}

function messageByteLength(data: string | ArrayBuffer | ArrayBufferView): number {
  if (typeof data === "string") {
    return new TextEncoder().encode(data).byteLength;
  }
  return data.byteLength;
}

function validateSelectedProtocol(
  selected: string | null,
  requestedHeader: string | null,
): string | null {
  if (!selected) {
    return null;
  }
  const requested = (requestedHeader ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
  if (!PROTOCOL_TOKEN.test(selected) || !requested.includes(selected)) {
    throw new Error("Upstream selected an invalid WebSocket subprotocol");
  }
  return selected;
}

function rejectUpstreamHandshake(upstream: WebSocket): void {
  try {
    upstream.accept({ allowHalfOpen: true });
    upstream.close(CLOSE_CODE_PROTOCOL_ERROR, CLOSE_REASON_PROTOCOL_ERROR);
  } catch {
    // The request still fails closed even if the upstream raced to close first.
  }
}
