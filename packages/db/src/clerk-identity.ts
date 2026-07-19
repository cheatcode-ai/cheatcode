/** A one-way stable identity used only for deletion fencing and tombstones. */
export async function clerkIdentityHash(clerkId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clerkId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
