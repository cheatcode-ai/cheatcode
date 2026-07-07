import { hmacSha256Base64 } from "@cheatcode/auth";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import { DaytonaClient } from "@cheatcode/tools-code";

interface LocalPreviewEnv {
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_ORG_ID?: string;
  DAYTONA_TARGET: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
}

interface LocalPreviewTarget {
  port: string;
  sandboxId: string;
}

interface VerifiedLocalPreviewToken {
  exp: number;
  mode: string;
  raw: string;
}

interface ResolvedLocalPreviewOrigin {
  originalHost: string;
  origin: {
    signed: boolean;
    token: string;
    url: string;
  };
  target: LocalPreviewTarget;
  token: VerifiedLocalPreviewToken;
  url: URL;
}

const DAYTONA_TOKEN_HEADER = "x-daytona-preview-token";
const DAYTONA_SKIP_WARNING_HEADER = "X-Daytona-Skip-Preview-Warning";
const FORWARDED_HOST_HEADER = "X-Forwarded-Host";
const LOCAL_PREVIEW_CLIENT_HOST_HEADER = "X-Cheatcode-Local-Preview-Client-Host";
const LOCAL_PREVIEW_HOST_SUFFIX = ".localhost";
const LOCAL_PREVIEW_HOST_PATTERN = /^([a-z0-9-]+)--(\d{1,5})$/;
const LOCAL_PREVIEW_CHILD_TOKEN_TTL_MS = 5 * 60 * 1000;
const PREVIEW_TOKEN_COOKIE = "cc_pt";
const PREVIEW_TOKEN_QUERY = "__cc_pt";
const PREVIEW_TOKEN_MODES = new Set(["app", "code", "takeover"]);

export async function tryHandleLocalPreviewRequest(
  request: Request,
  env: LocalPreviewEnv,
): Promise<Response | null> {
  const resolved = await resolveLocalPreviewOrigin(request, env);
  if (!resolved) return null;
  const { origin, originalHost, token, url } = resolved;
  const upstreamUrl = localPreviewUpstreamUrl(origin.url, url);
  if (isWebSocketUpgrade(request)) {
    return fetchLocalPreviewWebSocket(request, upstreamUrl, origin, originalHost);
  }
  const response = await fetchLocalPreviewOrigin(
    request,
    upstreamUrl,
    origin,
    originalHost,
    token.mode,
  );
  return withLocalPreviewSessionCookie(response, token);
}

export async function resolveLocalPreviewOrigin(
  request: Request,
  env: LocalPreviewEnv,
): Promise<ResolvedLocalPreviewOrigin | null> {
  const url = new URL(request.url);
  const target = parseLocalPreviewHost(request.headers.get("Host") ?? url.host);
  if (!target) {
    return null;
  }
  const secret = await resolveWorkerSecret(env.PREVIEW_TOKEN_SECRET);
  if (!secret) {
    throw new APIError(500, "internal_error", "Preview token secret is not configured", {
      retriable: false,
    });
  }
  const token = await verifyLocalPreviewToken(request, url, target, secret);
  const client = await localDaytonaClient(env);
  const origin = {
    ...(await client.getPreviewLink(target.sandboxId, Number(target.port))),
    signed: false,
  };
  return {
    originalHost: localPreviewClientHost(request, url),
    origin,
    target,
    token,
    url,
  };
}

function localPreviewClientHost(request: Request, url: URL): string {
  return (
    request.headers.get(LOCAL_PREVIEW_CLIENT_HOST_HEADER) ?? request.headers.get("Host") ?? url.host
  );
}

function parseLocalPreviewHost(host: string): LocalPreviewTarget | null {
  const hostname = (host.split(":")[0] ?? "").toLowerCase();
  if (!hostname.endsWith(LOCAL_PREVIEW_HOST_SUFFIX)) {
    return null;
  }
  const label = hostname.slice(0, hostname.length - LOCAL_PREVIEW_HOST_SUFFIX.length);
  const match = LOCAL_PREVIEW_HOST_PATTERN.exec(label);
  const sandboxId = match?.[1];
  const port = match?.[2];
  if (!sandboxId || !port) {
    return null;
  }
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) {
    return null;
  }
  return { port, sandboxId };
}

async function verifyLocalPreviewToken(
  request: Request,
  url: URL,
  target: LocalPreviewTarget,
  secret: string,
): Promise<VerifiedLocalPreviewToken> {
  const queryToken = url.searchParams.get(PREVIEW_TOKEN_QUERY);
  const raw =
    queryToken ??
    readCookie(request.headers.get("Cookie"), PREVIEW_TOKEN_COOKIE) ??
    previewTokenFromReferer(request);
  if (!raw) {
    const localChildToken = await trustedLocalPreviewChildToken(request, url, target, secret);
    if (localChildToken) {
      return localChildToken;
    }
    throw new APIError(401, "auth_token_missing", "Missing preview access token", {
      retriable: false,
    });
  }
  const [sandboxId, port, expRaw, mode, signature, ...extra] = raw.split(".");
  if (
    extra.length > 0 ||
    !sandboxId ||
    !port ||
    !expRaw ||
    !mode ||
    !signature ||
    !PREVIEW_TOKEN_MODES.has(mode)
  ) {
    throw invalidPreviewToken();
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    throw new APIError(401, "auth_token_expired", "Preview access token has expired", {
      retriable: false,
    });
  }
  if (sandboxId.toLowerCase() !== target.sandboxId || port !== target.port) {
    throw invalidPreviewToken();
  }
  const prefix = `${sandboxId}.${port}.${expRaw}.${mode}`;
  const expected = await hmacSha256Base64(prefix, secret);
  if (signature !== expected) {
    throw invalidPreviewToken();
  }
  return { exp, mode, raw };
}

function previewTokenFromReferer(request: Request): string | null {
  const referer = request.headers.get("Referer");
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).searchParams.get(PREVIEW_TOKEN_QUERY);
  } catch {
    return null;
  }
}

async function trustedLocalPreviewChildToken(
  request: Request,
  url: URL,
  target: LocalPreviewTarget,
  secret: string,
): Promise<VerifiedLocalPreviewToken | null> {
  if (!sameLocalPreviewTarget(url, target)) {
    return null;
  }
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  if (
    !sameLocalPreviewTargetHeader(origin, target) &&
    !sameLocalPreviewTargetHeader(referer, target) &&
    !isLocalPreviewProxyOrigin(origin)
  ) {
    return null;
  }
  const exp = Date.now() + LOCAL_PREVIEW_CHILD_TOKEN_TTL_MS;
  const mode = "code";
  const prefix = `${target.sandboxId}.${target.port}.${exp}.${mode}`;
  const raw = `${prefix}.${await hmacSha256Base64(prefix, secret)}`;
  return { exp, mode, raw };
}

function sameLocalPreviewTarget(url: URL, target: LocalPreviewTarget): boolean {
  const parsed = parseLocalPreviewHost(url.host);
  return parsed?.sandboxId === target.sandboxId && parsed.port === target.port;
}

function sameLocalPreviewTargetHeader(value: string | null, target: LocalPreviewTarget): boolean {
  if (!value) {
    return false;
  }
  try {
    return sameLocalPreviewTarget(new URL(value), target);
  } catch {
    return false;
  }
}

function isLocalPreviewProxyOrigin(value: string | null): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.host === "localhost:8787";
  } catch {
    return false;
  }
}

async function localDaytonaClient(env: LocalPreviewEnv): Promise<DaytonaClient> {
  const apiKey = await resolveWorkerSecret(env.DAYTONA_API_KEY);
  if (!apiKey) {
    throw new APIError(502, "upstream_sandbox_failed", "Daytona API key is not configured", {
      retriable: false,
    });
  }
  return new DaytonaClient({
    apiKey,
    apiUrl: env.DAYTONA_API_URL,
    target: env.DAYTONA_TARGET,
    ...(env.DAYTONA_ORG_ID ? { organizationId: env.DAYTONA_ORG_ID } : {}),
  });
}

async function fetchLocalPreviewOrigin(
  request: Request,
  upstreamUrl: URL,
  origin: { signed: boolean; token: string },
  originalHost: string,
  mode: string,
): Promise<Response> {
  const response = await fetch(upstreamUrl, localPreviewRequestInit(request, origin, originalHost));
  if (request.method !== "GET" || !isHtmlResponse(response)) {
    return response;
  }
  const text = await response.text();
  const action = daytonaWarningAcceptAction(text);
  if (!action) {
    return codePreviewHtmlResponse(text, response, mode);
  }
  const acceptCookie = await acceptDaytonaPreviewWarning(upstreamUrl, action, origin);
  const retryResponse = await fetch(
    upstreamUrl,
    localPreviewRequestInit(request, origin, originalHost, acceptCookie),
  );
  if (!isHtmlResponse(retryResponse)) {
    return retryResponse;
  }
  const retryText = await retryResponse.text();
  return codePreviewHtmlResponse(retryText, retryResponse, mode);
}

async function fetchLocalPreviewWebSocket(
  request: Request,
  upstreamUrl: URL,
  origin: { signed: boolean; token: string; url: string },
  originalHost: string,
): Promise<Response> {
  const wsRequest = new Request(upstreamUrl.toString(), request);
  wsRequest.headers.delete("Host");
  wsRequest.headers.delete("Cookie");
  if (!origin.signed) {
    wsRequest.headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  }
  wsRequest.headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  wsRequest.headers.set(FORWARDED_HOST_HEADER, originalHost);
  const browserOrigin =
    request.headers.get("Origin") ?? `${new URL(request.url).protocol}//${originalHost}`;
  const browserProtocol = new URL(browserOrigin).protocol.replace(":", "");
  wsRequest.headers.set("Origin", browserOrigin);
  wsRequest.headers.set("Forwarded", `host=${originalHost};proto=${browserProtocol}`);
  wsRequest.headers.set("X-Forwarded-Proto", browserProtocol);
  const response = await fetch(wsRequest);
  if (response.webSocket) {
    return new Response(null, { status: 101, webSocket: response.webSocket });
  }
  return response;
}

function localPreviewRequestInit(
  request: Request,
  origin: { signed: boolean; token: string },
  originalHost: string,
  cookie?: string | null,
): RequestInit {
  const headers = new Headers(request.headers);
  headers.delete("Host");
  headers.delete("Cookie");
  if (!origin.signed) {
    headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  }
  headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  headers.set(FORWARDED_HOST_HEADER, originalHost);
  const browserOrigin =
    request.headers.get("Origin") ?? `${new URL(request.url).protocol}//${originalHost}`;
  const browserProtocol = new URL(browserOrigin).protocol.replace(":", "");
  headers.set("Forwarded", `host=${originalHost};proto=${browserProtocol}`);
  headers.set("X-Forwarded-Proto", browserProtocol);
  headers.set("Accept-Encoding", "identity");
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const init: RequestInit = {
    headers,
    method: request.method,
    redirect: request.redirect,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return init;
}

function localPreviewUpstreamUrl(originUrl: string, requestUrl: URL): URL {
  const upstreamUrl = new URL(originUrl);
  const requestParams = new URLSearchParams(requestUrl.search);
  upstreamUrl.pathname = requestUrl.pathname;
  for (const [key, value] of requestParams) {
    upstreamUrl.searchParams.append(key, value);
  }
  upstreamUrl.searchParams.delete(PREVIEW_TOKEN_QUERY);
  upstreamUrl.searchParams.delete("cc_preview_reload");
  return upstreamUrl;
}

function isHtmlResponse(response: Response): boolean {
  return response.headers.get("Content-Type")?.toLowerCase().includes("text/html") ?? false;
}

function codePreviewHtmlResponse(html: string, response: Response, mode: string): Response {
  if (mode !== "code" || !isCodeServerWorkbenchHtml(html)) {
    return textResponse(html, response);
  }
  return textResponse(injectCodeServerBridge(html), response);
}

function textResponse(text: string, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.set("Cache-Control", "no-store");
  return new Response(text, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function isCodeServerWorkbenchHtml(html: string): boolean {
  return html.includes("code/didStartRenderer") && html.includes("workbench.js");
}

function injectCodeServerBridge(html: string): string {
  if (html.includes("__CHEATCODE_CS_BRIDGE__")) {
    return html;
  }
  const script = `<script nonce="1nline-m4p">${CHEATCODE_CODE_SERVER_BRIDGE_JS}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${script}`);
  }
  return `${script}${html}`;
}

const CHEATCODE_CODE_SERVER_BRIDGE_JS = String.raw`(function(){
if(window.__CHEATCODE_CS_BRIDGE__)return;
window.__CHEATCODE_CS_BRIDGE__=true;
if(window.parent===window)return;

var style=document.createElement("style");
style.textContent=[
".editor-watermark{display:none!important}",
".editor-group-letterpress{display:none!important}",
".editor-group-container.empty .editor-group-letterpress{display:none!important}",
".editor-group-watermark .letterpress{display:none!important}",
".editor-group-watermark .shortcuts{display:none!important}",
"[class*=\"letterpress\"]{display:none!important}",
"[class*=\"watermark-box\"]{display:none!important}",
".welcomePage,.gettingStartedContainer,.gettingStartedCategoriesContainer{display:none!important}",
"#workbench\\.parts\\.auxiliarybar,.part.auxiliarybar{display:none!important;width:0!important}",
"#workbench\\.parts\\.activitybar,.part.activitybar{display:none!important;width:0!important}",
"#workbench\\.parts\\.statusbar,.part.statusbar{display:none!important;height:0!important}",
".monaco-workbench.noactivitybar .part.sidebar{left:0!important}",
".monaco-workbench.noactivitybar .part.editor{left:auto!important}",
".pane-header[data-cheatcode-root-explorer-header='true']{display:none!important}",
".pane-header[aria-label='Outline Section'],.pane-header[aria-label='Timeline Section']{display:none!important}",
".monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-sidebar-root-view='true']{display:none!important;width:0!important;min-width:0!important;visibility:hidden!important}",
".monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true']{left:0!important;width:100%!important;max-width:100%!important}",
".monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .monaco-grid-branch-node,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .monaco-split-view2,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .monaco-scrollable-element,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .split-view-container,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .split-view-view,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .part.editor{width:100%!important;max-width:100%!important}",
".composite.title[data-cheatcode-root-explorer-title='true'] .title-label h2{text-transform:uppercase!important}",
".composite.title[data-cheatcode-root-explorer-title='true'] .title-actions>.actions{height:100%!important}",
".composite.title[data-cheatcode-root-explorer-title='true'] .title-actions .actions-container{height:100%!important;align-items:center!important}",
".editor-group-container.empty::after{content:\"\";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:80px;height:80px;opacity:.055;background:currentColor;mask:url(\"data:image/svg+xml,%3Csvg viewBox='0 0 48 48' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M24 3l5.7 12.5L43 21l-13.3 5.5L24 39l-5.7-12.5L5 21l13.3-5.5L24 3z'/%3E%3C/svg%3E\") center/contain no-repeat;-webkit-mask:url(\"data:image/svg+xml,%3Csvg viewBox='0 0 48 48' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M24 3l5.7 12.5L43 21l-13.3 5.5L24 39l-5.7-12.5L5 21l13.3-5.5L24 3z'/%3E%3C/svg%3E\") center/contain no-repeat;pointer-events:none}"
].join("");
(document.head||document.documentElement).appendChild(style);

function dispatchClick(target){
if(!target)return;
var pointerEvents=["pointerover","pointerenter","pointermove","pointerdown","pointerup"];
for(var i=0;i<pointerEvents.length;i++){
target.dispatchEvent(new PointerEvent(pointerEvents[i],{bubbles:true,cancelable:true,pointerType:"mouse",button:0,buttons:pointerEvents[i]==="pointerdown"?1:0}));
}
var mouseEvents=["mouseover","mouseenter","mousemove","mousedown","mouseup","click"];
for(var j=0;j<mouseEvents.length;j++){
target.dispatchEvent(new MouseEvent(mouseEvents[j],{bubbles:true,cancelable:true,button:0,buttons:mouseEvents[j]==="mousedown"?1:0}));
}
}

function visible(el){
if(!el)return false;
var rect=el.getBoundingClientRect();
return rect.width>0&&rect.height>0;
}

function normalizeExplorerChrome(){
try{
var sidebar=document.querySelector(".part.sidebar");
if(!sidebar)return;
var composite=sidebar.querySelector(".composite.title.has-actions");
var heading=composite&&composite.querySelector(".title-label h2");
var headers=sidebar.querySelectorAll(".pane-header[aria-label^='Explorer Section:']");
var sectionHeader=headers[0]||null;
if(!composite||!heading||!sectionHeader)return;
var sectionTitle=sectionHeader.querySelector("h3.title");
var title=(sectionTitle&&sectionTitle.textContent||sectionHeader.getAttribute("aria-label")||"").replace(/^Explorer Section:\s*/,"").trim();
if(!title)return;
if(heading.textContent!==title)heading.textContent=title;
if(!composite.hasAttribute("data-cheatcode-root-explorer-title")){
composite.setAttribute("data-cheatcode-root-explorer-title","true");
}
if(!sectionHeader.hasAttribute("data-cheatcode-root-explorer-header")){
sectionHeader.setAttribute("data-cheatcode-root-explorer-header","true");
}
sectionHeader.classList.add("hidden");
sectionHeader.setAttribute("aria-hidden","true");
var sectionActions=sectionHeader.querySelector(".actions");
var destination=composite.querySelector(".title-actions");
if(sectionActions&&destination&&sectionActions.parentElement!==destination){
destination.replaceChildren(sectionActions);
}
}catch(_err){}
}

function markWorkbenchSplitViews(){
try{
var sidebar=document.querySelector(".part.sidebar");
var editor=document.querySelector(".part.editor");
var workbench=document.querySelector(".monaco-workbench");
if(!sidebar||!editor||!workbench)return null;
var sidebarRoot=sidebar.closest(".split-view-view");
var horizontal=editor.closest(".monaco-split-view2.horizontal");
var editorRoot=null;
if(horizontal){
var roots=horizontal.querySelectorAll(":scope > .monaco-scrollable-element > .split-view-container > .split-view-view");
for(var i=0;i<roots.length;i++){
if(roots[i].contains(editor)){editorRoot=roots[i];break;}
}
}
if(!editorRoot)editorRoot=editor.closest(".split-view-view");
if(sidebarRoot)sidebarRoot.setAttribute("data-cheatcode-sidebar-root-view","true");
if(editorRoot)editorRoot.setAttribute("data-cheatcode-editor-root-view","true");
return {workbench:workbench,sidebar:sidebar,sidebarRoot:sidebarRoot,editorRoot:editorRoot};
}catch(_err){return null;}
}

var sidebarCollapsed=false;
function applySidebarState(collapsed){
var views=markWorkbenchSplitViews();
if(!views)return;
sidebarCollapsed=collapsed;
if(collapsed){
views.workbench.setAttribute("data-cheatcode-sidebar-collapsed","true");
}else{
views.workbench.removeAttribute("data-cheatcode-sidebar-collapsed");
}
reportSidebarState(views.sidebar);
setTimeout(function(){try{window.dispatchEvent(new Event("resize"));}catch(_err){}},0);
setTimeout(function(){try{window.dispatchEvent(new Event("resize"));}catch(_err){}},150);
}

function maybeOpenInitialDeliverable(){
try{
if(window.__CHEATCODE_CS_OPENED_INITIAL_DELIVERABLE__)return;
if(!document.querySelector(".editor-group-container.empty"))return;
var rows=document.querySelectorAll("[role='treeitem']");
for(var i=0;i<rows.length;i++){
var text=(rows[i].textContent||"").trim();
if(/\.(pptx?|pdf|docx?|xlsx?|ods|odt)\b/i.test(text)&&visible(rows[i])){
window.__CHEATCODE_CS_OPENED_INITIAL_DELIVERABLE__=true;
var target=rows[i].querySelector(".label-name,.monaco-icon-label,.monaco-tl-contents")||rows[i];
dispatchClick(target);
setTimeout(function(){dispatchClick(target)},250);
break;
}
}
}catch(_err){}
}

function closeAllEditors(){
var links=document.querySelectorAll("a");
var button=null;
for(var i=0;i<links.length;i++){
if(links[i].getAttribute("aria-label")==="More Actions..."){button=links[i];break;}
}
if(!button)return;
dispatchClick(button);
setTimeout(function(){
var items=document.querySelectorAll("[role=menuitem].action-menu-item");
for(var i=0;i<items.length;i++){
var text=(items[i].textContent||"").trim();
if(text.indexOf("Close All")===0){dispatchClick(items[i]);break;}
}
},300);
}

function toggleSidebar(){
applySidebarState(!sidebarCollapsed);
}

function closeWelcomeEditors(){
try{
var tabs=document.querySelectorAll(".tab");
for(var i=0;i<tabs.length;i++){
var label=(tabs[i].getAttribute("aria-label")||tabs[i].textContent||"").trim();
if(label.indexOf("Welcome")!==0)continue;
var close=tabs[i].querySelector("[aria-label^=\"Close\"]");
if(close)dispatchClick(close);
}
}catch(_err){}
}

function normalizeWorkbench(){
normalizeExplorerChrome();
markWorkbenchSplitViews();
if(sidebarCollapsed)applySidebarState(true);
maybeOpenInitialDeliverable();
}

window.addEventListener("message",function(event){
var message=event.data;
if(!message)return;
if(message.type==="CHEATCODE_CLOSE_ALL_EDITORS")closeAllEditors();
if(message.type==="CHEATCODE_TOGGLE_SIDEBAR")toggleSidebar();
if(message.type==="CHEATCODE_SET_SIDEBAR_COLLAPSED")applySidebarState(message.collapsed===true);
});

var lastSidebarVisible=null;
function reportSidebarState(sidebar){
var workbench=document.querySelector(".monaco-workbench");
var visible=!sidebarCollapsed&&!!sidebar&&!!workbench&&workbench.getAttribute("data-cheatcode-sidebar-collapsed")!=="true"&&sidebar.offsetWidth>0&&getComputedStyle(sidebar).display!=="none"&&getComputedStyle(sidebar).visibility!=="hidden";
if(visible!==lastSidebarVisible){
lastSidebarVisible=visible;
try{window.parent.postMessage({type:"CHEATCODE_SIDEBAR_STATE",visible:visible},"*")}catch(_err){}
}
}

var resizeObserver=new ResizeObserver(function(entries){
for(var i=0;i<entries.length;i++)reportSidebarState(entries[i].target);
});
var mutationObserver=new MutationObserver(function(){
normalizeWorkbench();
var sidebar=document.querySelector(".part.sidebar");
if(sidebar){
resizeObserver.observe(sidebar);
reportSidebarState(sidebar);
}
});

var cleanupRuns=0;
var cleanupInterval=null;
function runCleanup(){
normalizeWorkbench();
closeWelcomeEditors();
cleanupRuns++;
if(cleanupRuns>40&&cleanupInterval)clearInterval(cleanupInterval);
}
function startBridge(){
if(!document.body){setTimeout(startBridge,50);return;}
mutationObserver.observe(document.body,{childList:true,subtree:true});
cleanupInterval=setInterval(runCleanup,500);
runCleanup();
}
startBridge();
})();`;

function daytonaWarningAcceptAction(html: string): string | null {
  if (!html.includes("Preview URL Warning")) {
    return null;
  }
  const match = /<form\s+action="([^"]*accept-daytona-preview-warning[^"]*)"/iu.exec(html);
  return match?.[1]?.replaceAll("&amp;", "&") ?? null;
}

async function acceptDaytonaPreviewWarning(
  upstreamUrl: URL,
  action: string,
  origin: { signed: boolean; token: string },
): Promise<string | null> {
  const acceptUrl = new URL(action, upstreamUrl.origin);
  const headers = new Headers({ [DAYTONA_SKIP_WARNING_HEADER]: "true" });
  if (!origin.signed) {
    headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  }
  const response = await fetch(acceptUrl, {
    headers,
    method: "POST",
    redirect: "manual",
  });
  return response.headers.get("Set-Cookie")?.split(";", 1)[0] ?? null;
}

function withLocalPreviewSessionCookie(
  response: Response,
  token: VerifiedLocalPreviewToken,
): Response {
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  const maxAge = Math.max(0, Math.floor((token.exp - Date.now()) / 1000));
  wrapped.headers.append(
    "Set-Cookie",
    `${PREVIEW_TOKEN_COOKIE}=${token.raw}; Path=/; Max-Age=${maxAge}; SameSite=Lax`,
  );
  return wrapped;
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

function invalidPreviewToken(): APIError {
  return new APIError(401, "auth_token_invalid", "Invalid preview access token", {
    retriable: false,
  });
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const cookie of cookieHeader.split(";")) {
    const trimmed = cookie.trim();
    const separator = trimmed.indexOf("=");
    if (separator !== -1 && trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }
  return null;
}
