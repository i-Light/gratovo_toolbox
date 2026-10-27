import { signingStages } from "@gratovo/core/close";
import type { Creator } from "@gratovo/core/data";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { AudienceCheck } from "../close/audience-check";
import { KitEditor } from "../close/kit-editor";
import { useApp } from "../lib/store";
import { toast } from "../lib/toast";
import { strings } from "../strings";

const text = strings.close.card;

/** The stages where the card shows even before any number is known. */
const shownFrom: readonly string[] = [...signingStages, "signed"];

/**
 * The "Audience and rate" card on a creator's Overview (plan step 8): the kit link, the four
 * checks with what to do about them, and the form to type the numbers in. Money is the viewer's
 * to see: without it the numbers can be read but not edited here.
 */
export function CreatorAudience({ creatorId }: { readonly creatorId: string }) {
  const creator = useApp((s) => s.data.creators.find((c) => c.id === creatorId));
  const seesMoney = useApp((s) => s.data.seesMoney);
  const [editing, setEditing] = useState(false);
  if (creator === undefined || (creator.kit === null && !shownFrom.includes(creator.stage))) {
    return null;
  }
  return (
    <section className="col tight audience-card" data-ui="record.audience">
      <h4>{strings.close.audience.title}</h4>
      {editing && seesMoney ? (
        <KitEditor
          creator={creator}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : (
        <Body
          creator={creator}
          canEdit={seesMoney}
          onEdit={() => {
            setEditing(true);
          }}
        />
      )}
    </section>
  );
}

function Body({
  creator,
  canEdit,
  onEdit,
}: {
  readonly creator: Creator;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
}) {
  const kit = creator.kit;
  const link = kit?.link ?? null;
  const copy = (): void => {
    if (link === null) {
      return;
    }
    void navigator.clipboard
      .writeText(link)
      .then(() => {
        toast({ msg: text.linkCopied, icon: "copy", ms: 2500 });
      })
      .catch(() => undefined);
  };
  return (
    <>
      {kit === null ? (
        <p className="hint" data-ui="record.audience.empty">
          {text.empty}
        </p>
      ) : (
        <>
          {link === null || !link.startsWith("https://") ? null : (
            <div className="row small" data-ui="record.audience.link">
              <a href={link} target="_blank" rel="noreferrer">
                {text.kitLink}
              </a>
              <Btn kind="ghost" size="sm" icon="copy" onClick={copy}>
                {text.copyLink}
              </Btn>
            </div>
          )}
          <AudienceCheck creator={creator} />
        </>
      )}
      {canEdit ? (
        <div className="row">
          <Btn size="sm" kind={kit === null ? "" : "ghost"} icon="edit" onClick={onEdit}>
            {kit === null ? text.add : text.edit}
          </Btn>
        </div>
      ) : (
        <p className="hint">{text.noMoneyNote}</p>
      )}
    </>
  );
}
