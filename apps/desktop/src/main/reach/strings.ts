import type { RewriteHow } from "@gratovo/core/data";

/**
 * The English text Reach's drafter uses (plan step 6, D7 and D8), in one place so other
 * languages can follow: the agency's name the engine is told, the four rewrite notes Gemini
 * reads, and the example data's stand-in email and its stand-in edits. The stand-in is AI-niche
 * only and is never sent anywhere: the example data never calls Gemini or Gmail.
 */
export const reachStrings = {
  /** The agency's name in the comms facts, until step 8's Agency facts. */
  agencyName: "Gratovo",
  /** The steer note each rewrite sends Gemini (D8). */
  rewriteNotes: {
    shorter: "Make it shorter: keep only what matters.",
    warmer: "Make it warmer, without flattery.",
    direct: "Make it more direct: get to the question.",
    redo: "Write it again from a different angle, using another moment from their videos.",
  } satisfies Record<RewriteHow, string>,
  /** The steer note "That's not it" sends Gemini (D23): "Read their reply as: Not interested". */
  readAs: (label: string): string => `Read their reply as: ${label}`,
  /** The example data's first email, filled 0.9 s after the draft is made. */
  standIn: {
    subject: "your latest video",
    greeting: (contact: string | null): string => `Hi ${contact ?? "there"},`,
    /** Three short paragraphs; the first opens with a pleasantry on its own line. */
    paragraphs: (channel: string): readonly string[] => [
      `Thanks for the latest ${channel} video, it was a pleasure to watch.\nThe way you tested two AI coding tools side by side made the choice easy to follow.`,
      "We work with AI tool makers who sponsor creators, and one of them fits your audience well.",
      "Would you be open to a short note about it this week?",
    ],
    why: "It opens on a moment from their latest video and asks one small question.",
    rules: ["INF-FIRST-02", "FND-WRITE-11"],
  },
  /**
   * The example data's answer to a reply and the reading behind it (D23). AI-niche only, never
   * sent anywhere. `summaries` and `answers` are keyed by the situation id the stand-in picked;
   * `other` is for any id they don't name (a person's correction).
   */
  standInReply: {
    subject: (original: string): string =>
      /^re:/i.test(original.trim()) ? original : `Re: ${original}`,
    greeting: (contact: string | null): string => `Hi ${contact ?? "there"},`,
    why: "It answers what they asked, in their words, and asks one small question back.",
    rules: ["INF-REPLY-04", "FND-WRITE-11"],
    summaries: {
      "inf.gives_rate": "They gave a price for one video and some audience numbers.",
      "inf.not_interested": "They said no for now.",
      "inf.later": "They are busy and asked to talk later.",
      "inf.has_manager": "They pointed to a manager or an agency.",
      "inf.interested_vague": "They are open to it and want to know more.",
      "any.bounce": "The address did not accept the email.",
    } as Readonly<Record<string, string>>,
    other: "A person read this reply differently.",
    answers: {
      "inf.gives_rate": [
        "Thank you for the rate and the audience numbers, they help a lot.",
        "I will check them against the AI tool brands we are talking to this month and come back with a fit.",
      ],
      "inf.not_interested": [
        "Thanks for telling me straight, I appreciate it.",
        "If a brand that fits your channel comes up later, may I write once more?",
      ],
      "inf.later": [
        "No problem at all, thanks for answering.",
        "Would the first week of next month suit you better for a short note?",
      ],
      "inf.has_manager": [
        "Thanks for pointing me to the right person.",
        "I will write to them today and mention your latest video.",
      ],
      "inf.interested_vague": [
        "Glad it caught your eye. The brand is an AI tool maker that sponsors creators who test things for real.",
        "Would a short note with the details and a rough price range be useful?",
      ],
    } as Readonly<Record<string, readonly string[]>>,
    /** A goal draft's stand-ins: a kind no, and an ask for what the kit lacks. */
    declineAnswer: [
      "Thank you for sharing your numbers, I read them with care.",
      "This brand needs a different audience for now, so I will not move ahead. May I write when one fits better?",
    ] as readonly string[],
    missingNames: {
      top: "your top countries",
      age: "your main age group",
      engagement: "your engagement rate",
      rate: "your price for one video",
    } as Readonly<Record<"top" | "age" | "engagement" | "rate", string>>,
    askKitAnswer: (missing: readonly string[]): readonly string[] => [
      "Thank you for your reply, it helps.",
      missing.length === 0
        ? "Could you send your latest media kit once more?"
        : `Could you share ${missing.join(", ")}? It lets me check the fit with the AI tool brands.`,
    ],
    otherAnswer: [
      "Thanks for your reply, I read it with care.",
      "Could you tell me what would make a sponsorship a good fit for your channel?",
    ],
  },
  /** The stand-in rewrites' own lines (D8): deterministic edits of the text. */
  standInRewrite: {
    /** Warmer: a friendly line before the first paragraph. */
    warmerLine: "I hope your week is off to a good start.",
    /** New angle: the second paragraph's first line becomes this one. */
    redoLine:
      "Your viewers often ask which AI tools are worth paying for, and a sponsor that fits could answer that for them.",
  },
} as const;

/**
 * The words of the mailboxes (plan step 6b, D20): the activity log lines of the slowdown rule and
 * the test email. The test email is plain English with no template slots: it goes to the owner's
 * own address and is never stored.
 */
export const mailboxStrings = {
  /** The log line when bounces slow a mailbox: "outreach3 slowed to 20 sends a day: 4.2% bounced this week". */
  slowed: (name: string, cap: number, rate: number): string =>
    `${name} slowed to ${String(cap)} sends a day: ${String(rate)}% bounced this week`,
  /** The notification when bounces slow a mailbox (6d): "outreach3 slowed to 20 sends a day". */
  slowedNotice: (name: string, cap: number): string =>
    `${name} slowed to ${String(cap)} sends a day`,
  slowedSub: (rate: number): string => `${String(rate)}% bounced this week`,
  /** The log line when it recovers. */
  recovered: (name: string, cap: number): string => `${name} is back to ${String(cap)} sends a day`,
  testSubject: "Gratovo test email",
  testBody:
    "This is a test from Gratovo. If it reached your main inbox, mail from this address is landing well.",
} as const;

/**
 * The words of replies (plan step 6d, D23): the notifications and the activity log lines. Names
 * only, never an address or a body; the notification's second line is the reply's subject.
 */
export const replyStrings = {
  replied: (name: string): string => `${name} replied`,
  repliedPasted: (name: string): string => `Added ${name}'s reply by hand`,
  bounced: (name: string): string => `${name}'s email bounced`,
  /** The second line of a bounce's notification. */
  bouncedSub: "The address is marked not confirmed.",
  /** The second line of a reply's notification when the reply has no subject. */
  repliedSub: "Open Replies to read it.",
} as const;

/**
 * The activity log lines of the follow-up sequences (plan step 6c, D22). Names only, never an
 * address or a body.
 */
export const sequenceStrings = {
  stopped: (name: string): string => `Stopped the follow-ups to ${name}`,
  resumed: (name: string): string => `Resumed the follow-ups to ${name}`,
  parked: (name: string, until: number): string =>
    `Parked ${name} until ${new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
  woke: (name: string): string => `Woke ${name}`,
  finished: (name: string): string => `The follow-ups to ${name} are finished: no reply`,
} as const;

/** The activity log lines of Close's Decline kindly and Ask for what's missing (step 8). */
export const signingStrings = {
  declined: (name: string): string => `Declined ${name}: audience outside the US, UK, CA and AU`,
  undidDeclining: (name: string): string => `Undid declining ${name}`,
  asked: (name: string): string => `Asked ${name} for their missing numbers`,
} as const;
