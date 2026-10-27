import { Icon, PageHead, cx } from "@gratovo/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { useKeys } from "../lib/keys";
import { usePrototype } from "../lib/prototype";
import { meIsOwner, sectionsFor } from "../lib/settings";
import type { SettingsSection } from "../lib/settings";
import { appStore, go, selectRoute, useApp } from "../lib/store";
import { strings } from "../strings";
import { Results } from "./results";
import {
  AppearanceSection,
  KeyboardSection,
  NotificationsSection,
  ProfileSection,
  ShellSection,
} from "./sections";
import { ConnectionsSection } from "./connections-section";
import { PrototypeSection } from "./prototype-section";
import { SearchRulesSection } from "./search-rules-section";
import { WritingRulesSection } from "./writing-rules-section";

const text = strings.settings;
const { tabs } = strings.screens.settings;
const groups = ["you", "agency", "owner"] as const;

/** The view of a section: a working one, or the shell that names the step bringing its rows. */
function SectionView({ section }: { readonly section: SettingsSection }) {
  switch (section.key) {
    case "profile":
      return <ProfileSection />;
    case "appearance":
      return <AppearanceSection />;
    case "keyboard":
      return <KeyboardSection />;
    case "notifications":
      return <NotificationsSection />;
    case "search":
      return <SearchRulesSection />;
    case "connections":
      return <ConnectionsSection />;
    case "writing":
      return <WritingRulesSection />;
    case "prototype":
      return <PrototypeSection />;
    default:
      return <ShellSection section={section} />;
  }
}

/**
 * Brings a row into view when the palette or the search asked for it: scrolls it to the middle,
 * replays its highlight, focuses its first control and clears the request.
 */
function useSettingTarget(sectionKey: string, searching: boolean, clearSearch: () => void): void {
  const target = useApp((s) => s.ui.settingTarget);
  useEffect(() => {
    if (target === null) {
      return;
    }
    if (searching) {
      // The section is hidden behind the results; show it first, the effect runs again.
      clearSearch();
      return;
    }
    const el = document.getElementById(`set-${target}`);
    if (el !== null) {
      el.scrollIntoView({ block: "center" });
      el.classList.remove("hl");
      el.getBoundingClientRect(); // forces a reflow, so the animation restarts
      el.classList.add("hl");
      el.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    }
    appStore().ui((ui) => {
      ui.settingTarget = null;
    });
  }, [target, sectionKey, searching, clearSearch]);
}

/**
 * The Settings screen: a list of sections in two groups, a search that finds any row or section,
 * and the chosen section's rows. The route's tab picks the section.
 */
export function SettingsScreen() {
  const tab = useApp((s) => selectRoute(s).tab);
  const owner = useApp((s) => meIsOwner(s.data));
  const source = useApp((s) => s.data.source);
  // The Prototype section and its rows follow main's answer, so the screen listens to it.
  const proto = usePrototype().status;
  const available = sectionsFor(owner, source);
  // A section you may not open (an old link, a typed address) lands on Profile.
  const section = available.find((s) => s.key === tab) ?? available[0];
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim();
  const clearSearch = useCallback(() => {
    setQuery("");
  }, []);
  useKeys({
    "mod+f": () => {
      if (input.current === null) {
        return false;
      }
      input.current.focus();
      return true;
    },
  });
  useSettingTarget(section?.key ?? "", q !== "", clearSearch);
  if (section === undefined) {
    return null;
  }
  const note = text.sections[section.key].note ?? text.sections[section.key].sub;
  return (
    <div className="page" data-ui="settings.page">
      <PageHead
        dataUi="settings.head"
        title={text.title}
        sub={text.sub}
        right={
          <label className="set-search" data-ui="settings.search">
            <Icon name="search" />
            <input
              ref={input}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setQuery("");
                  event.currentTarget.blur();
                }
              }}
              placeholder={text.find}
              aria-label={text.find}
            />
          </label>
        }
      />
      <div className="set">
        <nav className="card tight set-nav" data-ui="settings.nav" aria-label={text.navLabel}>
          {groups
            .filter((group) => available.some((s) => s.group === group))
            .map((group) => (
              <div key={group} className="bucket">
                <div className="bucket-h">{text.groups[group]}</div>
                {available
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="li"
                      data-ui={`settings.nav.${s.key}`}
                      aria-current={q === "" && s.key === section.key ? "page" : undefined}
                      onClick={() => {
                        setQuery("");
                        go("settings", s.key);
                      }}
                    >
                      <span className="tb-ic">
                        <Icon name={s.icon} size={15} />
                      </span>
                      <span className="lt">
                        <b>{tabs[s.key]}</b>
                        <small>{text.sections[s.key].sub}</small>
                      </span>
                      {s.key === "prototype" && proto?.on === true ? (
                        <span className="cnt hot">{strings.prototype.on}</span>
                      ) : null}
                    </button>
                  ))}
              </div>
            ))}
        </nav>
        <div className="col" style={{ minWidth: 0 }}>
          {q === "" ? (
            <div
              className={cx("card", "set-pane")}
              key={section.key}
              data-ui={`settings.section.${section.key}`}
            >
              <div className="row top" style={{ gap: "12px" }}>
                <span
                  className="tb-ic"
                  style={{ width: "36px", height: "36px", borderRadius: "10px" }}
                >
                  <Icon name={section.icon} size={18} />
                </span>
                <div className="grow col t2">
                  <h2>{tabs[section.key]}</h2>
                  <p className="small ink2">
                    {note}
                    {section.group === "agency" ? ` ${text.agencyNote}` : ""}
                  </p>
                </div>
              </div>
              <SectionView section={section} />
            </div>
          ) : (
            <Results query={q} onPick={clearSearch} />
          )}
        </div>
      </div>
    </div>
  );
}
