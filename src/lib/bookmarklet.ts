/*
 * The Orrit connect bookmarklet, as a `javascript:` URL.
 *
 * Mirrors `rippit-extension/bookmarklet/connect.src.js`, which is the readable
 * source and carries the test harness. Kept in sync by hand — it is ~30 lines
 * and a build step to share it across two repos would cost more than it saves.
 *
 * Three properties matter:
 *
 *  - **It carries no Orrit credential.** The handoff lands on Orrit's own
 *    page where the user is already signed in, so the session does the
 *    claiming. Baking a token in would make the bookmarklet itself a bearer
 *    credential for the workspace.
 *  - **It never calls the API from GoHighLevel's origin.** It opens a tab to
 *    `/connect` with the payload in the URL *fragment*, which is never sent to
 *    any server — so the GHL token stays out of request lines and access logs,
 *    and Orrit's CORS list needn't cover every white-label agency domain.
 *  - **No alert()/confirm().** A modal on GHL's page would be rude and
 *    blocking; failures arrive as an `error` code on the same handoff.
 */

const SOURCE = `(async function(){
var B="__BASE__";
function h(p){p.v="1";var f=Object.keys(p).map(function(k){return encodeURIComponent(k)+"="+encodeURIComponent(p[k])}).join("&");
var w=window.open(B+"/connect#"+f,"_blank");if(!w)window.location.href=B+"/connect#"+f}
var m=String(window.location.href).match(/location\\/([A-Za-z0-9]+)/);var t;
try{t=await new Promise(function(res,rej){var o=indexedDB.open("firebaseLocalStorageDb");
o.onerror=function(){rej("no-store")};
o.onsuccess=function(){var tx;try{tx=o.result.transaction("firebaseLocalStorage","readonly")}catch(e){rej("not-logged-in");return}
var q=tx.objectStore("firebaseLocalStorage").getAll();q.onerror=function(){rej("read-failed")};
q.onsuccess=function(){var r=q.result||[];for(var i=0;i<r.length;i++){var v=r[i]&&r[i].value;var k=v&&v.stsTokenManager&&v.stsTokenManager.refreshToken;if(k)return res(k)}rej("no-token")}}})}
catch(c){return h({error:typeof c==="string"?c:"read-failed"})}
h(m?{rt:t,loc:m[1]}:{rt:t})})();`;

/** The draggable `href`. `base` is Orrit's own origin. */
export function bookmarkletHref(base: string): string {
  const origin = base.replace(/\/+$/, "");
  const filled = SOURCE.replace(/\s*\n\s*/g, "").replace("__BASE__", origin);
  // Only the characters that would terminate an href or a URL need escaping;
  // encoding everything bloats the link and makes it unreadable.
  return "javascript:" + filled.replace(/[%"<>#\s]/g, (c) => encodeURIComponent(c));
}

/** What the `/connect` page reads back out of the fragment. */
export interface HandoffPayload {
  refreshToken?: string;
  locationId?: string;
  error?: string;
}

export function parseHandoff(hash: string): HandoffPayload | null {
  const raw = hash.replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (!params.has("v")) return null;
  return {
    refreshToken: params.get("rt") ?? undefined,
    locationId: params.get("loc") ?? undefined,
    error: params.get("error") ?? undefined,
  };
}

/** Plain-language reasons the bookmarklet could not read a session. */
export const HANDOFF_ERRORS: Record<string, string> = {
  "not-logged-in":
    "That tab isn’t signed in to GoHighLevel. Sign in, then click the bookmark again.",
  "no-token":
    "No GoHighLevel session was found on that page. Sign out and back in, then try again.",
  "no-store":
    "Couldn’t read the GoHighLevel session in that browser. Try again in a normal (non-private) window.",
  "read-failed": "Couldn’t read the GoHighLevel session. Try again.",
};
