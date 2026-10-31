import { DEAL_FLOW } from "@gratovo/core";
import { Tag } from "@gratovo/ui";

import { sourceWords } from "../find/contact-block";
import { money } from "../lib/format";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { channelUrl, type CreatorDetail } from "./detail";
import { DescriptionSection, FitSection, NumbersSection } from "./creator-overview";
import { openFrom } from "./open-record";

const text = strings.creatorRecord;

/** The numbers, how the channel was found, the channel page, the description and the fit. */
export function ChannelTab({ item }: { readonly item: CreatorDetail }) {
  const link = channelUrl(item.id);
  return (
    <>
      <NumbersSection item={item} />
      {link === null ? null : (
        <a className="cr-link" href={link} target="_blank" rel="noreferrer">
          {text.openOnYouTube}
        </a>
      )}
      <DescriptionSection item={item} />
      <FitSection item={item} />
    </>
  );
}

/** The confirmed address and contact name, and every address found with where it came from. */
export function ContactsTab({ item }: { readonly item: CreatorDetail }) {
  const creator = useApp((s) => s.data.creators.find((c) => c.id === item.id));
  const email = creator?.email ?? item.email;
  const confirmed = creator?.emailConfirmed ?? item.emailConfirmed;
  const reader = creator === undefined ? item.contactName : creator.contactName;
  const c = text.contacts;
  return (
    <>
      <section className="col tight">
        <h4>{c.confirmed}</h4>
        {confirmed && email !== null ? <p>{email}</p> : <p className="hint">{c.confirmedNone}</p>}
        <h4>{c.reader}</h4>
        {reader === null || reader === "" ? (
          <p className="hint">{c.readerNone}</p>
        ) : (
          <p>{reader}</p>
        )}
      </section>
      <section className="col tight">
        <h4>{c.found}</h4>
        {item.emails.length === 0 ? (
          <p className="hint">{c.foundNone}</p>
        ) : (
          <ul className="cr-found">
            {item.emails.map((f) => (
              <li key={f.email}>
                <b>{f.email}</b>
                <span className="small muted">
                  {sourceWords(f)} {"·"} {strings.findContacts.block.sure(f.confidence)}
                </span>
                {f.business ? <Tag>{strings.findContacts.block.business}</Tag> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * The deals of a creator or of a brand, each opening its record. Price and payout show only to a
 * viewer who sees money. A creator's list names the brand, a brand's names the creator.
 */
export function DealsTab({
  by,
  id,
  signed = false,
  layout,
}: {
  readonly by: "creator" | "brand";
  readonly id: string;
  readonly signed?: boolean;
  readonly layout: "peek" | "page";
}) {
  const deals = useApp((s) => s.data.deals);
  const brands = useApp((s) => s.data.brands);
  const creators = useApp((s) => s.data.creators);
  const seesMoney = useApp((s) => s.data.seesMoney);
  const mine = deals.filter((d) => (by === "creator" ? d.creator === id : d.brand === id));
  const t = by === "creator" ? text.deals : strings.brandRecord.deals;
  if (mine.length === 0) {
    return (
      <>
        <p className="hint">{t.none}</p>
        {signed ? <p className="hint">{text.deals.noneSigned}</p> : null}
      </>
    );
  }
  return (
    <ul className="cr-deals" aria-label={t.label}>
      {mine.map((d) => {
        const name =
          (by === "creator"
            ? brands.find((b) => b.id === d.brand)?.name
            : creators.find((c) => c.id === d.creator)?.name) ?? strings.record.unknownName;
        const step = DEAL_FLOW[d.step]?.name ?? strings.record.unknownName;
        return (
          <li key={d.id}>
            <button
              type="button"
              className="cr-deal"
              data-ui="record.deal"
              aria-label={t.open(name, step)}
              onClick={() => {
                openFrom(layout, { kind: "deal", id: d.id });
              }}
            >
              <b>{name}</b>
              <Tag>{step}</Tag>
              {seesMoney && d.price !== null && d.payout !== null ? (
                <span className="n">{text.deals.money(money(d.price), money(d.payout))}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
