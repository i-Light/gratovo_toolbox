import { channels, type Channel } from "@gratovo/ipc";
import { describe, expect, it } from "vitest";

import { refusedWhileOn } from "./refused";

describe("refusedWhileOn", () => {
  it("names exactly the channels that could leave the computer", () => {
    expect([...refusedWhileOn].sort()).toEqual(
      [
        "connections:set",
        "connections:pick-folder",
        "mail:connect",
        "mail:check",
        "gateways:deploy",
        "gateways:remove",
        "import:candidates",
        "import:pick",
        "import:dry-run",
        "import:run",
        "reach:send-test",
        "gemini:start",
        "gemini:open-window",
      ].sort(),
    );
  });

  it("names real channels only, and never prototype mode's own", () => {
    for (const channel of refusedWhileOn) {
      expect(Object.keys(channels)).toContain(channel);
      expect(channel.startsWith("prototype:"), channel).toBe(false);
      expect(channel.startsWith("comments:"), channel).toBe(false);
    }
  });

  it("keeps sign-out, presence and stopping the bridge allowed", () => {
    const allowed: Channel[] = ["auth:sign-out", "presence:set", "gemini:stop"];
    for (const channel of allowed) {
      expect(refusedWhileOn.has(channel), channel).toBe(false);
    }
  });
});
