import { randomUUID } from "crypto";
import type { LDContext } from "@launchdarkly/node-server-sdk";

// Made-up visitors for the demo generator, the same ones results_generator.py
// invents, so both generators' traffic lands in the same segments and slices.

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function weighted<T>(options: readonly [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

const DEVICES = [
  ["Mobile", 58],
  ["Desktop", 36],
  ["Tablet", 6],
] as const satisfies readonly [string, number][];

const LOCATIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
] as const;

// role and tier carry the values, under the names, that contextFor in
// lib/ldContext.ts sends, so these match the Developers, Beta Testers, Gold
// Members and Platinum Members segments. Mostly ordinary shoppers.
export function shopperContext(): LDContext {
  return {
    kind: "user",
    key: `shopper-${randomUUID()}`,
    role: weighted([
      ["shopper", 94],
      ["beta", 5],
      ["developer", 1],
    ]),
    tier: weighted([
      ["none", 80],
      ["gold", 15],
      ["platinum", 5],
    ]),
    device: weighted(DEVICES),
    location: pick(LOCATIONS),
    referrer: pick(["google", "direct", "social", "email", "partner"]),
  };
}

// An anonymous visitor, the way the storefront sends one: no cartItemCount,
// which keeps flag 08's experiment traffic clear of the rules above it.
export function guestContext(): LDContext {
  return {
    kind: "user",
    key: `guest-${randomUUID()}`,
    anonymous: true,
    device: weighted(DEVICES),
    location: pick(LOCATIONS),
  };
}

// A card-testing bot. Anonymous because it is nobody's account, and a new key
// per attempt because these bots rotate through addresses to dodge rate
// limits.
export function botContext(): LDContext {
  return {
    kind: "user",
    key: `bot-${randomUUID()}`,
    anonymous: true,
  };
}
