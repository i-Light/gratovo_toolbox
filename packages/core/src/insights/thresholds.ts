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
  // P8b: deals and money.
  /** Net 30: an invoice is due 30 days after it is sent, and late the day after. */
  netDays: 30,
  /** An invoice over this many days late is Act now (Watch from 1). */
  invoiceAct: 30,
  /** Too much in one basket: one brand's share of 90 days' revenue over this is Watch. */
  basketShare: 0.4,
  /** An idle roster creator: signed, no deal in this many days. */
  idleDays: 60,
  /** Behind the monthly goal: the month's pace ends under this share of the goal. */
  behindGoal: 0.9,
  /** Course figures until there are enough of your own (marked as such in Goal). */
  courseCloseRate: 0.25,
  courseMargin: 0.4,
  courseDealSize: 2500,
  /** New creators to sign per deal won: a marked starting guess until yours is known. */
  guessSignsPerDeal: 0.5,
} as const;
