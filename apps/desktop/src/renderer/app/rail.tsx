import { Avatar, Icon, avatarColor, cx } from "@gratovo/ui";
import type { CSSProperties } from "react";
import { memo, useEffect, useRef } from "react";

import { signOut, useAccount } from "../lib/account";
import { duration } from "../lib/format";
import { useNarrow } from "../lib/media";
import { setPref, usePref } from "../lib/prefs";
import { screens, type ScreenKey } from "../lib/routes";
import { openMenu, openSetting, setShortcuts } from "../lib/actions";
import { go, selectRoute, useApp } from "../lib/store";
import { strings } from "../strings";

interface NavItemProps {
  readonly screen: ScreenKey;
  readonly current: boolean;
  readonly collapsed: boolean;
  /** The line under the name; null shows none. */
  readonly sub: string | null;
  /** The number beside the name; undefined or 0 shows none. */
  readonly count?: number | undefined;
  /** Draws the number in the accent colour. */
  readonly hot?: boolean | undefined;
}

/** One button in the rail: icon tile, name, line under it and a count that pops when it changes. */
const NavItem = memo(function NavItem({
  screen,
  current,
  collapsed,
  sub,
  count,
  hot,
}: NavItemProps) {
  const info = screens[screen];
  // The count shown at the last commit; written in an effect so a StrictMode double render still sees the change.
  const previous = useRef<number | undefined>(undefined);
  const bump = previous.current !== undefined && previous.current !== count;
  useEffect(() => {
    previous.current = count;
  });
  return (
    <button
      type="button"
      className="nav"
      style={{ "--hue": info.hue } as CSSProperties}
      aria-current={current ? "page" : undefined}
      // Collapsed, the name and count are hidden, so the button needs a name of its own.
      aria-label={collapsed ? info.name : undefined}
      data-tip={collapsed ? info.name : undefined}
      onClick={() => {
        go(screen);
      }}
    >
      <span className="nic">
        <Icon name={info.icon} />
      </span>
      <span className="nl">
        <b>{info.name}</b>
        {sub === null ? null : <small>{sub}</small>}
      </span>
      {count ? (
        <span key={`${screen}${String(count)}`} className={cx("cnt", hot && "hot", bump && "bump")}>
          {count}
        </span>
      ) : null}
      {count ? <i className="cnt-dot"></i> : null}
    </button>
  );
});

/** The rail's id, so the Menu button can name the drawer it opens. */
export const railId = "rail";

/**
 * The left rail: brand, the screens with their counts, and the account button with the collapse
 * toggle. It shows a drawer at narrow widths. Memoized: it re-renders only when a slice it shows changes.
 */
export const Rail = memo(function Rail() {
  // On a record page the screen it was opened from is the one marked.
  const screen = useApp((s) => {
    const route = selectRoute(s);
    return route.screen === "record" ? route.from : route.screen;
  });
  const settingsOpen = useApp((s) => selectRoute(s).screen === "settings");
  const accountMenuOpen = useApp((s) => s.ui.menu?.label === strings.menu.account);
  const counts = useApp((s) => s.data.counts);
  const myName = useApp((s) => s.data.myName);
  const me = useApp((s) => s.data.team.find((m) => m.id === s.data.me));
  const collapsed = usePref("rail") === "min";
  const railOpen = useApp((s) => s.ui.railOpen);
  const narrow = useNarrow();
  const account = useAccount();
  const { rail } = strings;

  const owner = me?.owner ?? false;
  const named = myName !== null;
  const memberName = me?.name ?? "";
  const shownName = myName ?? rail.addName;
  const role = me?.role ?? "";
  const nav = (key: ScreenKey, count?: number, hot?: boolean, sub?: string | null) => (
    <NavItem
      screen={key}
      current={screen === key}
      collapsed={collapsed}
      sub={sub === undefined ? screens[key].sub : sub}
      count={count}
      hot={hot}
    />
  );

  return (
    // At narrow widths the closed drawer is only moved off screen, so it is made inert: Tab
    // must not reach buttons nobody can see.
    <nav className="rail" id={railId} aria-label={rail.label} inert={narrow && !railOpen}>
      <div className="brand">
        <span className="logo" aria-hidden="true"></span>
        <div>
          <b>{strings.brand.name}</b>
          <small>{strings.brand.sub}</small>
        </div>
      </div>
      {nav(
        "today",
        counts.today,
        true,
        counts.today > 0 ? rail.planned(duration(counts.plannedMinutes)) : rail.allClear,
      )}
      <div className="nav-h">{rail.pipeline}</div>
      {nav("find", counts.find)}
      {nav("reach", counts.reach)}
      {nav("close", counts.close)}
      {nav("deliver", counts.deliver)}
      <div className="nav-h">{rail.workbench}</div>
      {nav("insights")}
      {nav("toolbox")}
      {nav("team")}
      <span className="sp"></span>
      <div className="rail-foot">
        <button
          type="button"
          className="me"
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          onClick={(event) => {
            openMenu(
              event.currentTarget.getBoundingClientRect(),
              [
                {
                  kind: "who",
                  name: named ? shownName : rail.addName,
                  sub: named ? role : strings.menu.unnamedSub,
                  color: avatarColor(owner ? "owner" : memberName),
                  unnamed: !named,
                  run: () => {
                    openSetting("profile", "name");
                  },
                },
                {
                  kind: "item",
                  label: strings.menu.settings,
                  icon: "gear",
                  hint: strings.keys.ctrlComma,
                  run: () => {
                    go("settings", "profile");
                  },
                },
                {
                  kind: "item",
                  label: strings.menu.appearance,
                  icon: "moon",
                  run: () => {
                    go("settings", "appearance");
                  },
                },
                {
                  kind: "item",
                  label: strings.menu.shortcuts,
                  icon: "keyboard",
                  hint: strings.keys.help,
                  run: () => {
                    setShortcuts(true);
                  },
                },
                { kind: "separator" },
                {
                  kind: "item",
                  label: strings.menu.notifications,
                  icon: "bell",
                  run: () => {
                    go("settings", "notifications");
                  },
                },
                ...(owner
                  ? [
                      {
                        kind: "item" as const,
                        label: strings.menu.connections,
                        icon: "gauge" as const,
                        run: () => {
                          go("settings", "connections");
                        },
                      },
                    ]
                  : []),
                ...(account.signedIn
                  ? [
                      { kind: "separator" as const },
                      {
                        kind: "item" as const,
                        label: strings.auth.signOut,
                        icon: "lock" as const,
                        run: () => {
                          void signOut();
                        },
                      },
                    ]
                  : []),
              ],
              strings.menu.account,
            );
          }}
          aria-current={settingsOpen ? "page" : undefined}
          // Expanded, the name and role on the button are its name; collapsed they are hidden.
          aria-label={collapsed ? rail.account(memberName) : undefined}
          data-tip={collapsed ? rail.memberTip(memberName, role) : undefined}
        >
          <Avatar
            name={myName ?? memberName}
            color={avatarColor(owner ? "owner" : memberName)}
            status={me?.status === "away" ? "away" : "online"}
            unnamed={!named}
            decorative={!collapsed}
          />
          <span className="nl">
            <b>{shownName}</b>
            <small>{rail.roleOnline(role)}</small>
          </span>
          <Icon name="chevU" size={14} className="me-chev" />
        </button>
        <button
          type="button"
          className="iconbtn rail-tog hide-narrow"
          onClick={() => {
            setPref("rail", collapsed ? "" : "min");
          }}
          aria-label={collapsed ? rail.expand : rail.collapse}
          data-tip={collapsed ? rail.expandTip : rail.collapseTip}
          data-kbd={strings.keys.rail}
        >
          <Icon name="sidebar" />
        </button>
      </div>
    </nav>
  );
});
