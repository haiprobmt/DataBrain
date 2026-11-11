import { daysBetween } from "./utils";

export interface FreshnessInput {
  status: string;
  lastVerifiedAt: Date | string | null;
}

/** A reviewed or verified item is stale once its last verification is older than the policy. */
export function isStale(item: FreshnessInput, policyDays: number, now = new Date()): boolean {
  if (item.status !== "verified" && item.status !== "reviewed") return false;
  if (!item.lastVerifiedAt) return item.status === "verified";
  return daysBetween(new Date(item.lastVerifiedAt), now) > policyDays;
}
