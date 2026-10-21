import type { Bridge } from "@gratovo/ipc/bridge";

/** For tests that open Find without caring about it: a bridge whose `find:state` fails and that has no events. */
export function stubFindBridge(): void {
  const invoke = () => Promise.resolve({ ok: false, reason: "test" });
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
}
