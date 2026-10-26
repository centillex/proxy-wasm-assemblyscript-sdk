export * from "@centillex/proxy-wasm-sdk/proxy";
import { Context, RootContext, registerRootContext, stream_context,
  FilterHeadersStatusValues } from "@centillex/proxy-wasm-sdk";

class HeaderRoot extends RootContext {
  createContext(id: u32): Context { return new HeaderFilter(id, this); }
}
class HeaderFilter extends Context {
  onResponseHeaders(count: u32, end: bool): FilterHeadersStatusValues {
    const configuration = this.root_context.getConfiguration();
    stream_context.headers.response.add("x-centillex-wasm", configuration.length ? configuration : "assemblyscript");
    return FilterHeadersStatusValues.Continue;
  }
}
registerRootContext((id: u32): RootContext => new HeaderRoot(id), "header");
