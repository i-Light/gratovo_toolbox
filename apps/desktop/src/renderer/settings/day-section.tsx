import { dayHours, morningHours } from "@gratovo/core/today";
import { Seg } from "@gratovo/ui";

import { setDayHours, setMorning } from "../lib/today-actions";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { Row } from "./row";

const { rows, dayHoursOption, dayMorningOption } = strings.settings;

/** Your day: how long Today plans for, and the hour snoozed items come back. Kept on this computer. */
export function DaySection() {
  const day = useApp((s) => s.data.settings.day);
  return (
    <>
      <Row id="dayHours" label={rows.dayHours.label} scope="device" desc={rows.dayHours.desc}>
        <Seg
          label={rows.dayHours.label}
          value={String(day.hours)}
          options={dayHours.map((h) => ({ value: String(h), label: dayHoursOption(h) }))}
          onPick={(v) => {
            const h = dayHours.find((x) => String(x) === v);
            if (h !== undefined) setDayHours(h);
          }}
        />
      </Row>
      <Row id="dayMorning" label={rows.dayMorning.label} scope="device" desc={rows.dayMorning.desc}>
        <Seg
          label={rows.dayMorning.label}
          value={String(day.morning)}
          options={morningHours.map((h) => ({ value: String(h), label: dayMorningOption(h) }))}
          onPick={(v) => {
            const h = morningHours.find((x) => String(x) === v);
            if (h !== undefined) setMorning(h);
          }}
        />
      </Row>
    </>
  );
}
