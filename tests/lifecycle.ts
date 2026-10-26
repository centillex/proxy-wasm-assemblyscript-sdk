export * from "@centillex/proxy-wasm-sdk/proxy";
import { Context, RootContext, registerRootContext, log, LogLevelValues,
  FilterHeadersStatusValues } from "@centillex/proxy-wasm-sdk";

let created: u32 = 0;
let deleted: u32 = 0;
let done: u32 = 0;
let rootsDeleted: u32 = 0;
let rootsDone: u32 = 0;
export function createdCount(): u32 { return created; }
export function deletedCount(): u32 { return deleted; }
export function doneCount(): u32 { return done; }
export function rootsDeletedCount(): u32 { return rootsDeleted; }
export function rootsDoneCount(): u32 { return rootsDone; }
class TestRoot extends RootContext {
  createContext(id: u32): Context { created++; return new TestContext(id, this); }
  onDone(): bool { rootsDone++; return super.onDone(); }
  onDelete(): void { rootsDeleted++; }
}
class TestContext extends Context {
  onRequestHeaders(count: u32, end: bool): FilterHeadersStatusValues {
    if (this.root_context.getConfiguration() == "abort") {
      assert(false, "intentional SDK assertion fixture");
    }
    if (this.root_context.getConfiguration() == "trap") unreachable();
    return FilterHeadersStatusValues.Continue;
  }
  onDone(): bool { done++; log(LogLevelValues.warn, "sdk-test-done"); return true; }
  onDelete(): void { deleted++; log(LogLevelValues.warn, "sdk-test-delete"); }
}
registerRootContext((id: u32): RootContext => new TestRoot(id), "lifecycle");
