// lib/ldServer.ts, answering with globalThis.stubClient.
export async function getServerClient() {
  return globalThis.stubClient ?? null;
}

export function contextFromRequest() {
  return { kind: "user", key: "guest", anonymous: true };
}

export function rolloutRunning() {
  return false;
}
