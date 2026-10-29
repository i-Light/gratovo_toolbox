/**
 * The numbers Insights judges by (design rules 3 and 5, section 4 and section 9). The course
 * figures are the owner's (2026-10-27); the rest are the design's defaults, which P6 moves into
 * Settings › Agency facts.
 */
export const thresholds = {
  /** The course's reply-rate floor. */
  replyFloor: 0.04,
  /** The course's creators signed per 1,000 emails. */
  signedPer1000: 5,
  /** Below this many emails a reply rate is "too early to tell" (the course's batch). */
  minEmails: 50,
  /** Below this many, any other rate is "too early to tell". */
  minOther: 20,
  /** The two-proportion test's confidence for "Clear difference". */
  confidence: 0.9,
  /** Stuck: more than this many times the usual time at a step. */
  stuckFactor: 2,
  /** At least this many known times before a median is shown. */
  minForMedian: 5,
  /** Fuel in days of sending: under `fuelWatch` is Watch, under `fuelAct` is Act now. */
  fuelWatch: 3,
  fuelAct: 1,
  /** A mailbox bounces: over this share of its last 7 days' sends, with at least `bounceMin` sends. */
  bounceShare: 0.03,
  bounceMin: 20,
  /** Batches of first emails. */
  batchSize: 50,
  /** Replies keep falling: this many batches in a row, with at least `fallingMin` emails. */
  fallingBatches: 3,
  fallingMin: 150,
  /** Mailbox room unused: under this share over 7 working days. */
  roomUsed: 0.6,
  /** A keyword is weak from this many found. */
  keywordMin: 50,
  /** Worn out: over this share of its last run already known. */
  wornOut: 0.8,
  /** Re-finds the archive: over this share of its last run already archived. */
  reFindsArchive: 0.3,
  /** A goal line is short under this share of what is needed a day. */
  stepShort: 0.8,
  /** No search for this many days with fuel under `noSearchFuel` days. */
  noSearchDays: 7,
  noSearchFuel: 5,
  /** The review backlog: Watch when it would take over this many days at your pace. */
  backlogDays: 5,
  /** Likely mistakes: rejected channels still waiting with at least this fit. */
  mistakeFit: 85,
  /** Rejects may be too strict: this many brought back for one reason in 90 days. */
  strictMin: 10,
  /** Many channels can't be read: over this share of live channels. */
  unreadableShare: 0.05,
  /** The same audience check keeps failing: in over half of at least this many checks. */
  auditMin: 10,
  /** The answer to a reply is late after this many hours. */
  answerHours: 24,
  /** Hide for 7 days. */
  hideDays: 7,
  /** Default goal: creators to sign a month, until the owner sets one. */
  signsPerMonth: 4,
} as const;
