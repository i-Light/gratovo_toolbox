import { useApp } from "../lib/store";
import { RosterKits, waitingForCheck } from "./roster-kits";
import { RosterSigned } from "./roster-signed";

/** Close › Roster: creators waiting for an audience check, then the signed ones. */
export function Roster() {
  const creators = useApp((s) => s.data.creators);
  const kits = creators.filter(waitingForCheck).sort((a, b) => a.name.localeCompare(b.name));
  const signed = creators.filter((c) => c.stage === "signed");
  return (
    <div className="close-roster" data-ui="close.roster">
      <RosterKits kits={kits} />
      <RosterSigned signed={signed} kitsWaiting={kits.length > 0} />
    </div>
  );
}
