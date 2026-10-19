import { Avatar, Btn, Empty, Icon, Seg, Switch, Tag, avatarColor } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";
import type { CSSProperties } from "react";
import { useRef, useState } from "react";

import { flashSetting, setMyName, setNotify } from "../lib/actions";
import { nameMax, setPref, usePref } from "../lib/prefs";
import type { NotifyKind, SettingsSection } from "../lib/settings";
import { go, useApp } from "../lib/store";
import { strings } from "../strings";
import { Row } from "./row";

const text = strings.settings;
const { rows, options } = text;

/** Profile: the account's face, your name (saved when you leave the field) and your role. */
export function ProfileSection() {
  const meId = useApp((s) => s.data.me);
  const myName = useApp((s) => s.data.myName);
  const me = useApp((s) => s.data.team.find((m) => m.id === s.data.me));
  const [draft, setDraft] = useState<string | null>(null);
  // Blur fires inside the key handler, before the re-render, so the handlers read the draft here.
  const draftRef = useRef<string | null>(null);
  const update = (value: string | null): void => {
    draftRef.current = value;
    setDraft(value);
  };
  const memberName = me?.name ?? "";
  const role = me?.role ?? "";
  const mine = meId === "u1";
  const shown = mine ? (myName ?? memberName) : memberName;
  const save = (): void => {
    const value = draftRef.current;
    if (value === null) {
      return;
    }
    update(null);
    const next = value.trim();
    if (next !== (myName ?? "")) {
      setMyName(next);
    }
  };
  return (
    <>
      <div className="set-hero">
        <Avatar
          name={shown}
          color={avatarColor(mine ? "owner" : memberName)}
          size="xl"
          unnamed={mine && myName === null}
          decorative
        />
        <div className="col t2">
          <b style={{ fontSize: "17px", fontWeight: 600 }}>{shown}</b>
          <span className="small muted">{role}</span>
        </div>
      </div>
      {mine ? (
        <Row id="name" label={rows.name.label} scope="you" desc={rows.name.desc}>
          <div className="col tight" style={{ minWidth: 0 }}>
            <input
              className="inp"
              value={draft ?? myName ?? ""}
              placeholder={text.profile.namePlaceholder}
              aria-label={rows.name.label}
              maxLength={nameMax}
              onChange={(event) => {
                update(event.currentTarget.value);
              }}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  // preventDefault keeps the key stack from also closing a peek or tray.
                  event.preventDefault();
                  update(null);
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="hint">
              {myName === null ? text.profile.notSet : text.profile.setHere}
            </span>
          </div>
        </Row>
      ) : null}
      <Row
        id="role"
        label={rows.role.label}
        desc={role === "Owner" ? rows.role.descOwner : rows.role.desc}
      >
        <div className="row wrap">
          <Tag icon="shield">{role}</Tag>
          <Btn
            size="sm"
            kind="ghost"
            icon="users"
            onClick={() => {
              go("team");
            }}
          >
            {text.profile.rolesInTeam}
          </Btn>
        </div>
      </Row>
    </>
  );
}

/** Appearance: density, text size, motion and sidebar, each saved on this computer at once. The app is
 * dark only for now, so there is no theme row. */
export function AppearanceSection() {
  const density = usePref("density");
  const size = usePref("size");
  const motion = usePref("motion");
  const rail = usePref("rail");
  return (
    <>
      <Row id="density" label={rows.density.label} scope="device" desc={rows.density.desc}>
        <Seg
          label={rows.density.label}
          value={density === "" ? "comfortable" : density}
          options={[
            { value: "comfortable", label: options.comfortable },
            { value: "compact", label: options.compact },
          ]}
          onPick={(v) => {
            setPref("density", v === "compact" ? "compact" : "");
            flashSetting("density");
          }}
        />
      </Row>
      <Row id="size" label={rows.size.label} scope="device" desc={rows.size.desc}>
        <Seg
          label={rows.size.label}
          value={size === "" ? "normal" : size}
          options={[
            { value: "normal", label: options.normal },
            { value: "large", label: options.large },
          ]}
          onPick={(v) => {
            setPref("size", v === "large" ? "large" : "");
            flashSetting("size");
          }}
        />
      </Row>
      <Row id="motion" label={rows.motion.label} scope="device" desc={rows.motion.desc}>
        <Seg
          label={rows.motion.label}
          value={motion === "" ? "system" : motion}
          options={[
            { value: "system", label: options.followComputer },
            { value: "reduce", label: options.reduce },
          ]}
          onPick={(v) => {
            setPref("motion", v === "reduce" ? "reduce" : "");
            flashSetting("motion");
          }}
        />
      </Row>
      <Row id="rail" label={rows.rail.label} scope="device" desc={rows.rail.desc}>
        <Seg
          label={rows.rail.label}
          value={rail === "min" ? "min" : "full"}
          options={[
            { value: "full", label: options.expanded },
            { value: "min", label: options.collapsed },
          ]}
          onPick={(v) => {
            setPref("rail", v === "min" ? "min" : "");
            flashSetting("rail");
          }}
        />
      </Row>
    </>
  );
}

const shortcutRow: CSSProperties = {
  justifyContent: "space-between",
  gap: "12px",
  padding: "4px 0",
  borderBottom: "1px solid var(--line)",
};

/** Keyboard: the single-letter keys switch, then every shortcut group (the same ones as the sheet). */
export function KeyboardSection() {
  const letters = usePref("letters");
  const on = letters !== "off";
  return (
    <>
      <Row id="letters" label={rows.letters.label} scope="device" desc={rows.letters.desc}>
        <div className="row">
          <Switch
            on={on}
            label={rows.letters.label}
            onChange={(next) => {
              setPref("letters", next ? "" : "off");
              flashSetting("letters");
            }}
          />
          <span className="small">{on ? text.on : text.off}</span>
        </div>
      </Row>
      <div className="grid2" style={{ alignItems: "start" }}>
        {strings.shortcuts.groups.map((group) => (
          <div key={group.title} className="col tight">
            <h4>{group.title}</h4>
            {group.rows.map(([keys, line]) => (
              <div key={keys} className="row small" style={shortcutRow}>
                <span className="ink2">{line}</span>
                <span className="kbd">{keys}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

const notifyIcons: readonly (readonly [NotifyKind, IconName])[] = [
  ["reply", "reply"],
  ["money", "wallet"],
  ["handoff", "forward"],
  ["search", "scan"],
];

/** Notifications: which kinds reach the bell (undoable), and the Problems switch that is always on. */
export function NotificationsSection() {
  const notify = useApp((s) => s.data.settings.notify);
  return (
    <Row id="notify" label={rows.notify.label} scope="you" desc={rows.notify.desc}>
      <div className="col tight" style={{ gap: "10px", minWidth: 0 }}>
        {notifyIcons.map(([kind, icon]) => (
          <div key={kind} className="row" style={{ gap: "10px" }}>
            <Switch
              on={notify[kind] !== false}
              label={text.notify[kind].label}
              onChange={(next) => {
                setNotify(kind, next);
              }}
            />
            <Icon name={icon} />
            <div className="col t2" style={{ minWidth: 0 }}>
              <span>{text.notify[kind].label}</span>
              <span className="tiny muted">{text.notify[kind].line}</span>
            </div>
          </div>
        ))}
        <div className="row" style={{ gap: "10px" }}>
          <Switch on disabled label={text.problems.label} onChange={() => undefined} />
          <Icon name="alert" />
          <div className="col t2">
            <span>{text.problems.label}</span>
            <span className="tiny muted">{text.problems.line}</span>
          </div>
        </div>
      </div>
    </Row>
  );
}

/** A section whose rows come with a later step: its icon and the step that brings them. */
export function ShellSection({ section }: { readonly section: SettingsSection }) {
  const step = section.arrives ?? 0;
  return (
    <div className="card tight">
      <Empty icon={section.icon} title={text.shell.title(step)}>
        {text.shell.line(step)}
      </Empty>
    </div>
  );
}
