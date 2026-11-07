import { Icon } from "@gratovo/ui";

import { strings } from "../strings";

/** The star rating as five stars, filled up to the rating. */
export function Stars({ n }: { readonly n: number }) {
  return (
    <span
      className="cr-stars"
      role="img"
      aria-label={strings.creatorRecord.header.stars(n)}
      data-ui="record.stars"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? "on" : undefined}>
          <Icon name="star" size={14} />
        </span>
      ))}
    </span>
  );
}
