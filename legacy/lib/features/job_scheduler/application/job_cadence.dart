/// How a [ScheduledJob]'s free-text `cadence` turns into its next run time.
///
/// Deliberately not cron: the foundation's own doc comment says `cadence` is
/// free text owned by whichever feature registers a job, and Wave 2's brief
/// asks for the three cadences an unattended local job actually needs —
/// nothing here has ever wanted "every second Tuesday". A job wanting finer
/// control can still get it: [nextRunAfter] falls back to daily for anything
/// it does not recognise, so an unknown cadence degrades to "runs, just not
/// as often as intended" rather than never running again.
library;

/// The next [DateTime] a job with this [cadence] should run, counted from
/// [from] — the moment it just ran (or, for a brand-new job, whatever moment
/// its owner wants the clock to start from).
///
/// Wall-clock arithmetic, not calendar-aware: "daily" is exactly 24 hours
/// later, so a job that runs at 09:00 keeps running at 09:00 straight through
/// a DST change rather than drifting by the hour the clocks moved. Good
/// enough for a local sweep; nothing here promises a fixed local time of day.
DateTime nextRunAfter(DateTime from, String cadence) {
  switch (cadence) {
    case 'hourly':
      return from.add(const Duration(hours: 1));
    case 'weekly':
      return from.add(const Duration(days: 7));
    case 'daily':
    default:
      return from.add(const Duration(days: 1));
  }
}
