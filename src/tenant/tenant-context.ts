import { AsyncLocalStorage } from "node:async_hooks";
export type Scope = { kind: "all" | "bu" | "subtree" | "function" | "jobLevel"; value?: string };
export interface Tenant { buId: string; scopes: Scope[]; }
const als = new AsyncLocalStorage<Tenant>();
export function runWithTenant<T>(t: Tenant, fn: () => T): T { return als.run(t, fn); }
export function getTenant(): Tenant | undefined { return als.getStore(); }
export function requireBu(): string {
  const t = als.getStore();
  if (!t) throw new Error("No tenant context");
  return t.buId;
}
