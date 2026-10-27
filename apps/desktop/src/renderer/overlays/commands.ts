import type { IconName } from "@gratovo/ui";

import { openSetting, peek, setShortcuts, undo } from "../lib/actions";
import { getPrefs, setPref } from "../lib/prefs";
import { firstTab, goLetters, screenOrder, screens } from "../lib/routes";
import type { RecordRef } from "../lib/routes";
import { isRouteShown, isScreenShown } from "../lib/wired";
import type { FrameSource } from "@gratovo/core/data";
import { getPrototype, setPanel, toggleCommenting } from "../lib/prototype";
import { meIsOwner, rowsFor, settingsSections } from "../lib/settings";
import { dealName, findRecord, go, recordName } from "../lib/store";
import type { AppData } from "../lib/store";
import { strings } from "../strings";
import { brandSub, creatorSub, dealSub } from "./record-text";

const { groups } = strings.palette;

/** One row of the command palette. */
export interface Command {
  /** The group heading it sits under. */
  readonly group: string;
  readonly icon: IconName;
  /** A creator's row shows an avatar instead of the icon. */
  readonly avatar?: { readonly name: string; readonly seed: string };
  readonly label: string;
  readonly sub?: string;
  /** Extra words the search also matches. */
  readonly words?: string;
  /** A key hint on the right. */
  readonly hint?: string;
  readonly run: () => void;
}

/** The most rows a search shows. */
export const maxResults = 14;
/** How many recent records the empty palette lists. */
const maxRecentShown = 5;
/** How many actions the empty palette lists. */
const maxActionsShown = 5;

/** The things you can do from the palette, in the order it lists them. */
export function actionCommands(source: FrameSource = "example"): readonly Command[] {
  const { actions } = strings.palette;
  const a = (icon: IconName, label: string, run: () => void, hint?: string): Command => ({
    group: groups.actions,
    icon,
    label,
    run,
    ...(hint === undefined ? {} : { hint }),
  });
  const finds: Command[] = [];
  if (isRouteShown({ screen: "find", tab: "triage" }, source)) {
    finds.push(
      a("scan", actions.reviewFinds, () => {
        go("find", "triage");
      }),
    );
  }
  if (isRouteShown({ screen: "find", tab: "contacts" }, source)) {
    finds.push(
      a("at", actions.confirmContacts, () => {
        go("find", "contacts");
      }),
    );
  }
  const proto: Command[] =
    getPrototype().status?.on === true
      ? [
          {
            group: strings.palette.groups.prototype,
            icon: "chat",
            label: strings.prototype.paletteComment,
            hint: strings.prototype.commentHint,
            run: () => {
              toggleCommenting(true);
            },
          },
          {
            group: strings.palette.groups.prototype,
            icon: "list",
            label: strings.prototype.paletteShowAll,
            run: () => {
              setPanel(true);
            },
          },
        ]
      : [];
  return [
    ...finds,
    a("undo", actions.undo, undo, strings.actions.undoKbd),
    a(
      "keyboard",
      actions.shortcuts,
      () => {
        setShortcuts(true);
      },
      strings.keys.help,
    ),
    a(
      "gear",
      actions.settings,
      () => {
        go("settings", "profile");
      },
      strings.keys.ctrlComma,
    ),
    a("rows", actions.density, () => {
      setPref("density", getPrefs().density === "compact" ? "" : "compact");
    }),
    ...proto,
  ];
}

/** "Go to" rows: every screen in the rail's order, on its first tab, as "G then a letter" opens it. */
export function goCommands(source: FrameSource = "example"): readonly Command[] {
  const letterOf = new Map(Object.entries(goLetters).map(([letter, key]) => [key, letter]));
  return screenOrder
    .filter((key) => isScreenShown(key, source))
    .map((key) => {
      const letter = letterOf.get(key);
      return {
        group: groups.goTo,
        icon: screens[key].icon,
        label: screens[key].name,
        ...(letter === undefined ? {} : { hint: strings.palette.goHint(letter) }),
        run: () => {
          go(key, firstTab(key));
        },
      };
    });
}

/** One row for every setting that exists now: the section's icon, the row's name, the section's name beside it. */
export function settingCommands(
  owner: boolean,
  source: FrameSource = "example",
): readonly Command[] {
  const tabs = strings.screens.settings.tabs;
  return rowsFor(owner, source).map((row): Command => {
    const section = settingsSections.find((s) => s.key === row.section);
    const r = strings.settings.rows[row.id];
    return {
      group: groups.settings,
      icon: section?.icon ?? "gear",
      label: r.label,
      sub: tabs[row.section],
      words: r.words,
      run: () => {
        openSetting(row.section, row.id);
      },
    };
  });
}

/** Rows for every creator, brand and deal: opening one shows it in the peek. */
export function recordCommands(data: AppData): readonly Command[] {
  const open = (kind: RecordRef["kind"], id: string) => () => {
    peek({ kind, id });
  };
  return [
    ...data.creators.map((c): Command => ({
      group: groups.creators,
      icon: "user",
      avatar: { name: c.name, seed: c.handle },
      label: c.name,
      sub: creatorSub(c),
      run: open("creator", c.id),
    })),
    ...data.brands.map((b): Command => ({
      group: groups.brands,
      icon: "flag",
      label: b.name,
      sub: brandSub(b),
      run: open("brand", b.id),
    })),
    ...data.deals.map((d): Command => ({
      group: groups.deals,
      icon: "box",
      label: dealName(data, d),
      sub: dealSub(d),
      run: open("deal", d.id),
    })),
  ];
}

const recentIcons: Readonly<Record<RecordRef["kind"], IconName>> = {
  creator: "user",
  brand: "flag",
  deal: "box",
};

/** The records opened lately, newest first, at most five; ones that no longer exist are left out. */
export function recentCommands(data: AppData, recent: readonly RecordRef[]): readonly Command[] {
  const rows: Command[] = [];
  for (const ref of recent) {
    if (findRecord(data, ref) === undefined) {
      continue;
    }
    rows.push({
      group: groups.recent,
      icon: recentIcons[ref.kind],
      label: recordName(data, ref),
      sub: strings.record.kinds[ref.kind].toLowerCase(),
      run: () => {
        peek(ref);
      },
    });
  }
  return rows.slice(0, maxRecentShown);
}

/**
 * The palette's rows for what was typed. Nothing typed: recent records, the first five actions,
 * then every screen. Something typed: the actions, screens and records whose label, sub line or
 * words contain it (any case), at most 14.
 */
export function buildCommands(
  data: AppData,
  recent: readonly RecordRef[],
  query: string,
): readonly Command[] {
  const actions = actionCommands(data.source);
  const goTo = goCommands(data.source);
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...recentCommands(data, recent), ...actions.slice(0, maxActionsShown), ...goTo];
  }
  return [
    ...actions,
    ...goTo,
    ...settingCommands(meIsOwner(data), data.source),
    ...recordCommands(data),
  ]
    .filter((c) => `${c.label} ${c.sub ?? ""} ${c.words ?? ""}`.toLowerCase().includes(needle))
    .slice(0, maxResults);
}
