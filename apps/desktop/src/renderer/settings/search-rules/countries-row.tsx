import { Tag } from "@gratovo/ui";

import { strings } from "../../strings";
import { Row } from "../row";
import type { Draft, Rules } from "./draft";

const text = strings.settings.searchRules;
const rows = strings.settings.rows;

/** The countries row: the picked countries as a tag, or chips to pick them while editing. */
export function CountriesRow(props: {
  readonly draft: Draft | null;
  readonly rules: Rules;
  readonly countryList: readonly string[];
  readonly set: (patch: Partial<Draft>) => void;
}) {
  const { draft, rules, countryList, set } = props;
  return (
    <Row
      id="rulesCountries"
      label={rows.rulesCountries.label}
      scope="team"
      desc={rows.rulesCountries.desc}
      ui="settings.search.countries"
    >
      {draft === null ? (
        <div className="fchips">
          <Tag icon="globe">
            {rules.countries.length > 0
              ? rules.countries.join(" · ")
              : strings.findSearch.rules.noCountries}
          </Tag>
        </div>
      ) : (
        <div className="fchips" role="group" aria-label={text.countriesGroup}>
          {countryList.map((country) => {
            const on = draft.countries.includes(country);
            return (
              <button
                key={country}
                type="button"
                className="chip"
                aria-pressed={on}
                onClick={() => {
                  set({
                    countries: countryList.filter((c) =>
                      c === country ? !on : draft.countries.includes(c),
                    ),
                  });
                }}
              >
                {country}
              </button>
            );
          })}
        </div>
      )}
    </Row>
  );
}
