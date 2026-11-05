// Orvexa Appwrite client configuration.
// Project ID and endpoint are public client configuration, not secrets.
import { Client } from "https://cdn.jsdelivr.net/npm/appwrite@17.0.0/+esm";

const APPWRITE_ENDPOINT = "https://nyc.cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "6aec5d0a0037bce8adeb";

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

// Run one connectivity check per page load. This does not expose or use API keys.
let pingStarted = false;

export async function pingAppwriteOnce() {
  if (pingStarted) return;
  pingStarted = true;
  try {
    if (typeof client.ping === "function") {
      await client.ping();
      console.info("[Orvexa] Appwrite connection successful.");
    } else {
      console.warn("[Orvexa] This Appwrite SDK version does not expose client.ping().");
    }
  } catch (error) {
    console.error("[Orvexa] Appwrite connection check failed:", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", pingAppwriteOnce, { once: true });
} else {
  pingAppwriteOnce();
}
