export const CODE_SERVER_PORT = 13_340;
export const MAX_CODE_SERVER_HTML_BYTES = 4 * 1024 * 1024;

const PARENT_ORIGIN_PLACEHOLDER = "__CHEATCODE_PARENT_ORIGIN_JSON__";

/**
 * Detect the code-server workbench shell without transforming arbitrary
 * generated-application HTML.
 */
export function isCodeServerWorkbenchHtml(html: string): boolean {
  return html.includes("code/didStartRenderer") && html.includes("workbench.js");
}

/**
 * Inject Cheatcode's parent bridge into the authenticated code-server shell.
 * The exact top-level application origin is embedded by the trusted proxy, not
 * accepted from an untrusted browser header or query parameter.
 */
export function injectCodeServerParentBridge(html: string, parentOrigin: string): string {
  if (html.includes("__CHEATCODE_CS_BRIDGE__")) {
    return html;
  }
  const normalizedParentOrigin = normalizeParentOrigin(parentOrigin);
  const serializedParentOrigin = JSON.stringify(normalizedParentOrigin).replaceAll("<", "\\u003c");
  const bridge = CHEATCODE_CODE_SERVER_BRIDGE_JS.replace(
    PARENT_ORIGIN_PLACEHOLDER,
    serializedParentOrigin,
  );
  const script = `<script nonce="1nline-m4p">${bridge}</script>`;
  if (/<head[^>]*>/iu.test(html)) {
    return html.replace(/<head([^>]*)>/iu, `<head$1>${script}`);
  }
  return `${script}${html}`;
}

function normalizeParentOrigin(parentOrigin: string): string {
  const url = new URL(parentOrigin);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.origin !== parentOrigin ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("Code-server parent origin must be an exact HTTP(S) origin");
  }
  return url.origin;
}

const CHEATCODE_CODE_SERVER_BRIDGE_JS = String.raw`(function(){
if(window.__CHEATCODE_CS_BRIDGE__)return;
window.__CHEATCODE_CS_BRIDGE__=true;
if(window.parent===window)return;
var cheatcodeParentOrigin=__CHEATCODE_PARENT_ORIGIN_JSON__;
var cheatcodeInitialFilePath=new URL(window.location.href).searchParams.get("cc_open_file")||"";
var cheatcodeInitialFileName=cheatcodeInitialFilePath.split("/").filter(Boolean).pop()||"";

var cheatcodeTheme=new URL(window.location.href).searchParams.get("cc_theme");
if(cheatcodeTheme==="dark"||cheatcodeTheme==="light"){
document.documentElement.setAttribute("data-cheatcode-theme",cheatcodeTheme);
document.documentElement.style.colorScheme=cheatcodeTheme;
var nativeMatchMedia=window.matchMedia.bind(window);
window.matchMedia=function(query){
var nativeResult=nativeMatchMedia(query);
var normalized=String(query).toLowerCase();
var wantsDark=normalized.indexOf("prefers-color-scheme: dark")!==-1;
var wantsLight=normalized.indexOf("prefers-color-scheme: light")!==-1;
if(!wantsDark&&!wantsLight)return nativeResult;
return new Proxy(nativeResult,{get:function(target,property){
if(property==="matches")return wantsDark?cheatcodeTheme==="dark":cheatcodeTheme==="light";
var value=Reflect.get(target,property,target);
return typeof value==="function"?value.bind(target):value;
}});
};
}

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
".monaco-workbench:not([data-cheatcode-sidebar-collapsed='true']) .split-view-view[data-cheatcode-sidebar-root-view='true']{width:289px!important;min-width:289px!important;max-width:289px!important}",
".monaco-workbench:not([data-cheatcode-sidebar-collapsed='true']) .split-view-view[data-cheatcode-sidebar-root-view='true'] .part.sidebar{width:289px!important;max-width:289px!important}",
".monaco-workbench:not([data-cheatcode-sidebar-collapsed='true']) .split-view-view[data-cheatcode-editor-root-view='true']{left:289px!important;width:calc(100% - 289px)!important;max-width:calc(100% - 289px)!important}",
".monaco-workbench:not([data-cheatcode-sidebar-collapsed='true']) .split-view-view[data-cheatcode-editor-root-view='true'] .part.editor>.content{width:100%!important;max-width:100%!important}",
".monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-sidebar-root-view='true']{display:none!important;width:0!important;min-width:0!important;visibility:hidden!important}",
".monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true']{left:0!important;width:100%!important;max-width:100%!important}",
".monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .monaco-grid-branch-node,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .monaco-split-view2,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .monaco-scrollable-element,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .split-view-container,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .split-view-view,.monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .part.editor{width:100%!important;max-width:100%!important}",
".monaco-workbench[data-cheatcode-sidebar-collapsed='true'] .split-view-view[data-cheatcode-editor-root-view='true'] .part.editor>.content{width:100%!important;max-width:100%!important}",
".composite.title[data-cheatcode-root-explorer-title='true'] .title-label h2{text-transform:uppercase!important}",
".composite.title[data-cheatcode-root-explorer-title='true'] .title-actions>.actions{height:100%!important}",
".composite.title[data-cheatcode-root-explorer-title='true'] .title-actions .actions-container{height:100%!important;align-items:center!important}",
".editor-group-container.empty::after{display:none!important}",
".cheatcode-directory-state{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--vscode-editor-background,#fff);color:var(--vscode-editor-foreground,#616161);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}",
".cheatcode-directory-tabbar{display:flex;height:48px;min-height:48px;border-bottom:1px solid var(--vscode-tab-border,#e5e5e5);background:var(--vscode-editorGroupHeader-tabsBackground,#fafafa)}",
".cheatcode-directory-tab{display:flex;height:48px;min-width:166px;max-width:260px;align-items:center;gap:8px;border-right:1px solid var(--vscode-tab-border,#e5e5e5);background:var(--vscode-tab-activeBackground,#fff);padding:0 12px;font-size:14px;color:var(--vscode-tab-activeForeground,#333)}",
".cheatcode-directory-tab-menu{width:12px;color:var(--vscode-tab-inactiveForeground,#888);font-size:13px;line-height:1}",
".cheatcode-directory-tab-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
".cheatcode-directory-tab-close{margin-left:auto;color:var(--vscode-tab-inactiveForeground,#555);font-size:20px;font-weight:300;line-height:1}",
".cheatcode-directory-main{display:flex;min-height:0;flex:1;align-items:center;justify-content:center;padding:32px}",
".cheatcode-directory-message{display:flex;max-width:520px;flex-direction:column;align-items:center;text-align:center}",
".cheatcode-directory-error{width:58px;height:58px;color:#d73522}",
".cheatcode-directory-copy{margin-top:20px;font-size:14px;line-height:20px;color:var(--vscode-editor-foreground,#616161)}",
".cheatcode-directory-actions{display:flex;gap:8px;margin-top:14px}",
".cheatcode-directory-action{height:34px;border:0;border-radius:2px;padding:0 14px;font:inherit;font-size:14px;cursor:pointer}",
".cheatcode-directory-action-primary{background:var(--vscode-button-background,#191919);color:var(--vscode-button-foreground,#fff)}",
".cheatcode-directory-action-secondary{background:var(--vscode-button-secondaryBackground,#e7e7e7);color:var(--vscode-button-secondaryForeground,#333)}",
".cheatcode-computer-empty{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:var(--vscode-editor-background,#fff);overflow:hidden}",
".cheatcode-computer-mark{position:absolute;left:50%;top:50%;width:72px;height:72px;transform:translate(-50%,-50%);color:var(--vscode-disabledForeground,#f0f0f0)}",
".cheatcode-computer-mark-main,.cheatcode-computer-mark-small{position:absolute;display:block;line-height:1;font-family:Georgia,serif}",
".cheatcode-computer-mark-main{inset:0;font-size:72px}",
".cheatcode-computer-mark-small{right:-2px;bottom:2px;font-size:28px}"
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
var wasCollapsed=views.workbench.getAttribute("data-cheatcode-sidebar-collapsed")==="true";
if(collapsed&&!wasCollapsed){
views.workbench.setAttribute("data-cheatcode-sidebar-collapsed","true");
}else if(!collapsed&&wasCollapsed){
views.workbench.removeAttribute("data-cheatcode-sidebar-collapsed");
}
reportSidebarState(views.sidebar);
if(wasCollapsed===collapsed)return;
setTimeout(function(){try{window.dispatchEvent(new Event("resize"));}catch(_err){}},0);
setTimeout(function(){try{window.dispatchEvent(new Event("resize"));}catch(_err){}},150);
}

function maybeOpenInitialFile(){
try{
if(window.__CHEATCODE_CS_OPENED_INITIAL_DELIVERABLE__)return;
if(!document.querySelector(".editor-group-container.empty"))return;
var rows=document.querySelectorAll("[role='treeitem']");
for(var i=0;i<rows.length;i++){
var text=(rows[i].textContent||"").trim();
var isRequestedFile=cheatcodeInitialFileName&&text.indexOf(cheatcodeInitialFileName)!==-1;
var isDeliverable=/\.(pptx?|pdf|docx?|xlsx?|ods|odt)\b/i.test(text);
if((isRequestedFile||(!cheatcodeInitialFileName&&isDeliverable))&&visible(rows[i])){
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
var tabs=document.querySelectorAll(".tab");
if(!tabs.length)return true;
for(var i=0;i<tabs.length;i++){
var close=tabs[i].querySelector("[aria-label^='Close']");
if(close)dispatchClick(close);
}
return false;
}

function collapseExplorerFolders(){
var expanded=document.querySelectorAll(".part.sidebar [role='treeitem'][aria-expanded='true']");
if(!expanded.length)return true;
var button=document.querySelector("[aria-label='Collapse Folders in Explorer']");
if(!button)return false;
dispatchClick(button);
return false;
}

var workspaceResetRequested=false;
function resetWorkspaceView(){
var editorsReady=closeAllEditors();
var explorerReady=collapseExplorerFolders();
if(editorsReady&&explorerReady)workspaceResetRequested=false;
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

function currentWorkspaceName(){
try{
var folder=new URL(window.location.href).searchParams.get("folder")||"";
var segments=folder.split("/").filter(Boolean);
if(segments.length)return decodeURIComponent(segments[segments.length-1]);
}catch(_err){}
var heading=document.querySelector(".composite.title .title-label h2");
return ((heading&&heading.textContent)||"workspace").trim().toLowerCase();
}

function focusExplorer(){
var tree=document.querySelector(".part.sidebar [role='tree']");
var firstRow=document.querySelector(".part.sidebar [role='treeitem']");
if(tree&&typeof tree.focus==="function")tree.focus();
if(firstRow&&typeof firstRow.scrollIntoView==="function")firstRow.scrollIntoView({block:"nearest"});
}

function ensureDirectoryState(){
try{
var states=document.querySelectorAll(".cheatcode-directory-state,.cheatcode-computer-empty");
for(var i=0;i<states.length;i++){
var owner=states[i].closest(".editor-group-container");
if(!owner||!owner.classList.contains("empty"))states[i].remove();
}
var group=document.querySelector(".editor-group-container.empty");
if(!group||group.querySelector(":scope > .cheatcode-directory-state,:scope > .cheatcode-computer-empty"))return;
var state=document.createElement("div");
if(currentWorkspaceName().toLowerCase()==="computer"&&!cheatcodeInitialFileName){
state.className="cheatcode-computer-empty";
state.setAttribute("aria-hidden","true");
state.innerHTML='<span class="cheatcode-computer-mark"><span class="cheatcode-computer-mark-main">✦</span><span class="cheatcode-computer-mark-small">✦</span></span>';
group.appendChild(state);
return;
}
state.className="cheatcode-directory-state";
state.innerHTML='<div class="cheatcode-directory-tabbar"><div class="cheatcode-directory-tab"><span class="cheatcode-directory-tab-menu">☰</span><span class="cheatcode-directory-tab-label"></span><span class="cheatcode-directory-tab-close">×</span></div></div><div class="cheatcode-directory-main"><div class="cheatcode-directory-message"><svg class="cheatcode-directory-error" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-width="4"/><path d="M22 22l20 20M42 22L22 42" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg><div class="cheatcode-directory-copy">The file is not displayed in the text editor because it is a directory.</div><div class="cheatcode-directory-actions"><button class="cheatcode-directory-action cheatcode-directory-action-primary" type="button">Open Folder</button><button class="cheatcode-directory-action cheatcode-directory-action-secondary" type="button">Reveal Folder</button></div></div></div>';
var label=state.querySelector(".cheatcode-directory-tab-label");
if(label)label.textContent=currentWorkspaceName();
var actions=state.querySelectorAll(".cheatcode-directory-action");
for(var j=0;j<actions.length;j++)actions[j].addEventListener("click",focusExplorer);
group.appendChild(state);
}catch(_err){}
}

function normalizeWorkbench(){
normalizeExplorerChrome();
markWorkbenchSplitViews();
if(sidebarCollapsed)applySidebarState(true);
if(workspaceResetRequested)resetWorkspaceView();
maybeOpenInitialFile();
ensureDirectoryState();
reportBridgeReady();
}

window.addEventListener("message",function(event){
if(event.source!==window.parent||event.origin!==cheatcodeParentOrigin)return;
var message=event.data;
if(!message)return;
if(message.type==="CHEATCODE_REQUEST_CODE_SERVER_STATE"){
if(bridgeReadyReported)postBridgeReady();
else normalizeWorkbench();
var requestedSidebar=document.querySelector(".part.sidebar");
if(requestedSidebar)reportSidebarState(requestedSidebar);
}
if(message.type==="CHEATCODE_CLOSE_ALL_EDITORS")closeAllEditors();
if(message.type==="CHEATCODE_RESET_WORKSPACE_VIEW"){workspaceResetRequested=true;resetWorkspaceView();}
if(message.type==="CHEATCODE_TOGGLE_SIDEBAR")toggleSidebar();
if(message.type==="CHEATCODE_SET_SIDEBAR_COLLAPSED")applySidebarState(message.collapsed===true);
});

var bridgeReadyReported=false;
function postBridgeReady(){
try{window.parent.postMessage({type:"CHEATCODE_CODE_SERVER_READY"},cheatcodeParentOrigin)}catch(_err){}
}
function reportBridgeReady(){
if(bridgeReadyReported)return;
var views=markWorkbenchSplitViews();
var collapse=document.querySelector("[aria-label='Collapse Folders in Explorer']");
if(!views||!collapse)return;
bridgeReadyReported=true;
postBridgeReady();
}

var lastSidebarVisible=null;
function reportSidebarState(sidebar){
var workbench=document.querySelector(".monaco-workbench");
var visible=!sidebarCollapsed&&!!sidebar&&!!workbench&&workbench.getAttribute("data-cheatcode-sidebar-collapsed")!=="true"&&sidebar.offsetWidth>0&&getComputedStyle(sidebar).display!=="none"&&getComputedStyle(sidebar).visibility!=="hidden";
if(visible!==lastSidebarVisible){
lastSidebarVisible=visible;
try{window.parent.postMessage({type:"CHEATCODE_SIDEBAR_STATE",visible:visible},cheatcodeParentOrigin)}catch(_err){}
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
