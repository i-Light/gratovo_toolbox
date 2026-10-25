// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { initPrefs } from "../lib/prefs";
import { screenOrder, screens } from "../lib/routes";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { buildCommands, maxResults } from "./commands";

const { groups } = strings.palette;

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

const data = () => appStore().getState().data;

describe("buildCommands", () => {
  it("lists the first five actions, then every screen, when nothing is typed", () => {
    const rows = buildCommands(data(), [], "");
    const actions = Object.values(strings.palette.actions);
    expect(rows.map((r) => r.label)).toEqual([
      ...actions.slice(0, 5),
      ...screenOrder.map((key) => screens[key].name),
    ]);
    expect(rows.slice(0, 5).every((r) => r.group === groups.actions)).toBe(true);
    expect(rows.slice(5).every((r) => r.group === groups.goTo)).toBe(true);
  });

  it("puts recent records first, newest first, and leaves out ones that no longer exist", () => {
    const rows = buildCommands(
      data(),
      [
        { kind: "brand", id: "b2" },
        { kind: "creator", id: "gone" },
        { kind: "creator", id: "c1" },
      ],
      "",
    );
    const recent = rows.filter((r) => r.group === groups.recent);
    expect(recent.map((r) => r.label)).toEqual(["Lumen AI", "Prompt Lab"]);
    expect(rows.slice(0, 2)).toEqual(recent);
  });

  it("shows at most five recent records", () => {
    const refs = ["c1", "c2", "c3", "c4", "c5", "c11"].map((id) => ({
      kind: "creator" as const,
      id,
    }));
    const rows = buildCommands(data(), refs, "");
    expect(rows.filter((r) => r.group === groups.recent)).toHaveLength(5);
  });

  it("matches a creator by name in any case, with the creators group", () => {
    const rows = buildCommands(data(), [], "PROMPT lab");
    expect(rows.map((r) => [r.group, r.label])).toEqual([
      [groups.creators, "Prompt Lab"],
      [groups.deals, "VoxCraft × Prompt Lab"],
    ]);
  });

  it("matches a screen by name", () => {
    const rows = buildCommands(data(), [], "reach");
    expect(rows.some((r) => r.group === groups.goTo && r.label === screens.reach.name)).toBe(true);
  });

  it("returns nothing for nonsense", () => {
    expect(buildCommands(data(), [], "zzzqqq")).toEqual([]);
  });

  it("caps a search at 14 rows", () => {
    expect(maxResults).toBe(14);
    expect(buildCommands(data(), [], "e")).toHaveLength(14);
  });

  it("shows the G hint on screens", () => {
    const reach = buildCommands(data(), [], "").find((r) => r.label === screens.reach.name);
    expect(reach?.hint).toBe(strings.palette.goHint("r"));
  });

  it("lists the settings between the screens and the records, and opens the row", () => {
    const rows = buildCommands(data(), [], "compact");
    expect(rows.map((r) => [r.group, r.label])).toEqual([
      [groups.actions, strings.palette.actions.density],
      [groups.settings, strings.settings.rows.density.label],
    ]);
    const density = rows[1];
    expect(density?.sub).toBe(strings.screens.settings.tabs.appearance);
    expect(density?.icon).toBe("moon");
    density?.run();
    expect(appStore().getState().ui.settingTarget).toBe("density");
    expect(selectRoute(appStore().getState())).toMatchObject({
      screen: "settings",
      tab: "appearance",
    });
  });

  it("does not list settings when nothing is typed", () => {
    expect(buildCommands(data(), [], "").some((r) => r.group === groups.settings)).toBe(false);
  });
});

describe("the live gate", () => {
  const liveData = () => ({ ...data(), source: "live" as const });

  it("lists no Go to rows for hidden screens, and the review and contacts actions", () => {
    const rows = buildCommands(liveData(), [], "");
    const goTo = rows.filter((r) => r.group === groups.goTo).map((r) => r.label);
    expect(goTo).toEqual([screens.find.name, screens.toolbox.name, screens.settings.name]);
    const actions = rows.filter((r) => r.group === groups.actions).map((r) => r.label);
    expect(actions).toContain(strings.palette.actions.reviewFinds);
    expect(actions).toContain(strings.palette.actions.confirmContacts);
  });

  it("finds no hidden settings in a search", () => {
    const rows = buildCommands(liveData(), [], "Your day");
    expect(rows.some((r) => r.group === groups.settings)).toBe(false);
  });
});
