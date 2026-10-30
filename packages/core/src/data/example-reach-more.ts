import { readReplyFacts } from "../reach/reply-facts";

import type { ExampleDraft } from "./example";
import { exampleChannelId } from "./example-roster";
import type { NewMessage } from "./outreach-store";
import type { DraftProposal, ReplyReading, Sequence } from "./reach-types";

/**
 * The reach rows of the creators the full example roster adds (plan step P1-3): the six more
 * creators in a sequence, the three who replied, the one parked, and two more first emails
 * waiting. The words come from the full prototype's threads and drafts (`workbench-v6`), with the
 * rule codes left out. Everything is timed from `now` and sits before it, so no step is due when
 * the seed loads (the stand-in drafter writes nothing by itself).
 *
 * Only outreach1 and outreach2 send here: outreach3's week is pinned by a test.
 */

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const id = exampleChannelId;
const me = "u1";
const box1 = "outreach1@gratovo.example";
const box2 = "outreach2@gratovo.example";

interface Who {
  readonly peer: string;
  readonly name: string;
}

/** Who answers the mail of each creator that gets a message here. */
const people: Readonly<Record<string, Who>> = {
  c18: { peer: "contact@buildwithllms.dev", name: "Sam" },
  c19: { peer: "collab@latentlounge.ai", name: "Mia" },
  c20: { peer: "hello@copilotcorner.com", name: "Ben" },
  c21: { peer: "studio@pixeldiffusion.art", name: "Ines" },
  c22: { peer: "tokentalks.yt@gmail.com", name: "Ravi" },
  c23: { peer: "gradientguy@proton.me", name: "Leo" },
  c24: { peer: "team@botbuilder.dev", name: "Ola" },
  c25: { peer: "hey@diffusiondaily.co", name: "Noor" },
  c26: { peer: "vectorvibes@outlook.com", name: "Ana" },
  c46: { peer: "team@finetunefriday.io", name: "Hugo" },
};

function whoOf(key: string): Who {
  const who = people[key];
  if (who === undefined) throw new Error(`The example has no contact for ${key}`);
  return who;
}

/** A message in the thread of `key`, with the fields every one of them shares. */
function message(
  n: number,
  key: string,
  direction: "in" | "out",
  at: number,
  mailbox: string,
  subject: string,
  body: string,
  extra: Partial<NewMessage> = {},
): NewMessage {
  const who = whoOf(key);
  const creator = id(key);
  return {
    id: `msg${String(n)}`,
    creator,
    direction,
    kind: direction === "out" ? "first" : null,
    followUp: null,
    subject,
    body,
    bodyCut: false,
    at,
    mailbox,
    peer: who.peer,
    peerName: who.name,
    conversationKey: `c:${creator}`,
    gmailMessageId: `gm-msg${String(n)}`,
    gmailThreadId: `gt-${creator}`,
    draftId: null,
    by: direction === "out" ? me : null,
    source: direction === "out" ? "app" : "sweep",
    reading: null,
    ...extra,
  };
}

const followUp = (n: number): Partial<NewMessage> => ({ kind: "followUp", followUp: n });

function reading(
  replyType: string,
  label: string,
  summary: string,
  body: string,
  facts: boolean,
): ReplyReading {
  return {
    replyType,
    label,
    summary,
    side: "influencer",
    corrected: false,
    facts: facts ? readReplyFacts(body) : [],
  };
}

const askedPay =
  "Hey, thanks! Yes, open to it. What do these usually pay? I've never done a sponsor before and I don't want to sound like an ad.";
const bookedUp = "Thanks, but I'm fully booked until the new year. Maybe ping me in January?";
const gaveRate =
  "Hey! Thanks for reaching out. My rate for a 60-second integration is $900. Audience is US 46%, UK 9%, Canada 8%, mostly 25-34. Happy to chat.";
const notNowFriday =
  "Thanks for thinking of us. We are full through the end of the year, so ask again in the spring.";

/** The threads of the creators in a sequence, the three who replied and the parked one. */
export function moreMessages(now: number): readonly NewMessage[] {
  const ago = (days: number, hours = 0): number => now - days * day - hours * hour;
  return [
    // In a sequence: the first email, and the follow-ups already sent.
    message(
      20,
      "c21",
      "out",
      ago(4),
      box1,
      "Your Midjourney v8 breakdown",
      "Hi Ines,\n\nThe side-by-side hand-rendering test at 14:10 in your Midjourney v8 breakdown showed the exact prompt delta without cherry-picking outputs. We work with creative AI brands like Clipforge and VoxCraft that sponsor workflow breakdowns. Would paid integrations be of interest?\n\nMoustafa, Gratovo",
    ),
    message(
      21,
      "c22",
      "out",
      ago(11),
      box2,
      "Your API cost breakdown",
      "Hi Ravi,\n\nAt 3:40 in \"I spent $500 on AI APIs so you don't\", your cost-per-1K-output-tokens table exposed the hidden retry overhead developers miss. We're planning campaigns for Codewell and Agentic HQ next month. Open to seeing how a 60-90 s integration would look?\n\nMoustafa, Gratovo",
    ),
    message(
      22,
      "c22",
      "out",
      ago(7),
      box2,
      "Re: Your API cost breakdown",
      "Hi Ravi,\n\nQuick addition to my note: your newer upload on collapsing token prices lines up directly with what Codewell's engineering buyers watch. Open to a quick look?\n\nMoustafa",
      followUp(1),
    ),
    message(
      23,
      "c23",
      "out",
      ago(2),
      box1,
      "Backprop explained with pizza",
      'Hi Leo,\n\nAt 5:18 in "Backprop explained with pizza", walking through the chain-rule gradient step by hand before showing PyTorch code is why engineering students stick through the whole video. We\'re planning campaigns for Codewell and Lumen AI. Open to paid integrations?\n\nMoustafa, Gratovo',
    ),
    message(
      24,
      "c24",
      "out",
      ago(13),
      box2,
      "Your support bot teardown",
      "Hi Ola,\n\nAt 6:12 in your 4,000-ticket support bot teardown, showing the exact fallback prompt that prevented hallucinated refunds is what SaaS buyers look for. We're planning campaigns for Inboxly and Agentic HQ. Open to sponsors?\n\nMoustafa, Gratovo",
      { by: "u2" },
    ),
    message(
      25,
      "c24",
      "out",
      ago(10),
      box2,
      "Re: Your support bot teardown",
      "Hi Ola,\n\nQuick check-in on my note from Monday. Inboxly is locking their November creator roster this week. Worth a quick look?\n\nMoustafa",
      { ...followUp(1), by: "u2" },
    ),
    message(
      26,
      "c24",
      "out",
      ago(6),
      box2,
      "Re: Your support bot teardown",
      "Hi Ola,\n\nYour newer upload on no-code agents hit 45K views in a week, and Agentic HQ is booking that exact audience right now. Open to hearing the details?\n\nMoustafa",
      { ...followUp(2), by: "u2" },
    ),
    message(
      27,
      "c25",
      "out",
      ago(0, 1.25),
      box1,
      "Your blind Flux vs Midjourney test",
      "Hi Noor,\n\nAt 7:22 in your blind Flux vs Midjourney test, holding lighting prompts constant across 12 product shots made the benchmark genuinely reproducible. We work with creative AI brands like Clipforge and VoxCraft. Open to hearing about paid integrations?\n\nMoustafa, Gratovo",
    ),
    message(
      28,
      "c26",
      "out",
      ago(4),
      box1,
      "Vector databases in 8 minutes",
      'Hi Ana,\n\nAt 4:05 in "Vector databases in 8 minutes", your diagram comparing HNSW recall against latency made the trade-off immediately clear for backend engineers. We\'re looking to pair you with brands like Codewell and Pagewise. Open to hearing more?\n\nMoustafa, Gratovo',
    ),
    // Replied: Build with LLMs asks what it pays (an answer is drafted), Latent Lounge is
    // booked until January (answered, parked), Copilot Corner gives a rate (an answer is drafted).
    message(
      30,
      "c18",
      "out",
      ago(10, 1),
      box1,
      "Your RAG whiteboard video",
      "Hi Sam,\n\nAt 5:48 in your RAG whiteboard video, you walked through the chunk-overlap failure mode that most tutorials skip, which is why developers actually finish your builds. We're pairing AI educators with developer-tool sponsors for November. Open to hearing how paid integrations work?\n\nMoustafa, Gratovo",
    ),
    message(31, "c18", "in", ago(1, -0.1), box1, "Re: Your RAG whiteboard video", askedPay, {
      reading: reading(
        "inf.interested_vague",
        "Interested, asks what it pays",
        "Open to sponsors, first time. Worried the integration will sound like an ad. Asked what it pays.",
        askedPay,
        false,
      ),
    }),
    message(
      32,
      "c19",
      "out",
      ago(9),
      box1,
      "Your 7B-on-a-laptop video",
      "Hi Mia,\n\nAt 4:12 in your 7B-on-a-laptop video, you benchmarked token-per-second drop-off under real memory pressure instead of synthetic prompts, which gives local-LLM builders a real buying signal. We pair AI channels with developer tools they'd use on camera anyway. Open to hearing about paid integrations?\n\nMoustafa, Gratovo",
    ),
    message(33, "c19", "in", ago(3, 3), box1, "Re: Your 7B-on-a-laptop video", bookedUp, {
      reading: reading(
        "inf.later",
        "Not now, try again later",
        "Booked until the new year. Asked to be contacted in January.",
        bookedUp,
        false,
      ),
    }),
    message(
      34,
      "c19",
      "out",
      ago(3, 2.8),
      box1,
      "Re: Your 7B-on-a-laptop video",
      "Hi Mia,\n\nTotally understood, congrats on the full Q4 schedule. I'll check back in early January when Q1 campaigns open up.\n\nMoustafa",
      { kind: "reply" },
    ),
    message(
      35,
      "c20",
      "out",
      ago(6),
      box1,
      "Your Copilot vs Cursor test",
      "Hi Ben,\n\nAt 6:30 in your 30-day Copilot vs Cursor test, you kept the failed multi-file refactor in the cut to show where context windows actually break. We pair developer channels with coding tools for paid 60-90 s integrations. Open to hearing what we're planning?\n\nMoustafa, Gratovo",
    ),
    message(36, "c20", "in", ago(0, 1.7), box1, "Re: Your Copilot vs Cursor test", gaveRate, {
      reading: reading(
        "inf.gives_rate",
        "Gives their rate or rate card",
        "Interested. Shared a rate and the audience split in the first reply.",
        gaveRate,
        true,
      ),
    }),
    // Parked: Fine-Tune Friday is full until spring.
    message(
      37,
      "c46",
      "out",
      ago(20),
      box2,
      "Your LoRA video",
      "Hi Hugo,\n\nYour LoRA walkthrough explained the rank setting better than the paper did, and the dataset mistakes section was honest. We work with AI tool brands that look for exactly this kind of channel. Would you be open to a paid sponsorship?\n\nMoustafa",
    ),
    message(38, "c46", "in", ago(14), box2, "Re: Your LoRA video", notNowFriday, {
      reading: reading(
        "inf.later",
        "Not now, try again later",
        "Full through the end of the year. Asked to come back in the spring.",
        notNowFriday,
        false,
      ),
    }),
    message(
      39,
      "c46",
      "out",
      ago(14, -0.2),
      box2,
      "Re: Your LoRA video",
      "Hi Hugo,\n\nThank you for the honest answer. I will check in again in the spring.\n\nMoustafa",
      { kind: "reply" },
    ),
  ];
}

/** The follow-up sequences of the creators above. None has a step due when the seed loads. */
export function moreSequences(now: number): readonly Sequence[] {
  const step = (
    n: number,
    dueAt: number,
    state: "planned" | "sent" | "skipped",
    sentAt: number | null,
  ) => ({ n, dueAt, state, sentAt });
  // A step due today would count as due at load, so the ones v6 had due today wait a day.
  const soon = now + day;
  const base = (key: string, mailbox: string, startedAt: number) => ({
    creator: id(key),
    mailbox,
    startedAt,
    stopped: null,
    parkUntil: null,
  });
  return [
    {
      ...base("c21", box1, now - 4 * day),
      steps: [
        step(1, soon, "planned", null),
        step(2, now + 4 * day, "planned", null),
        step(3, now + 11 * day, "planned", null),
      ],
    },
    {
      ...base("c22", box2, now - 11 * day),
      steps: [
        step(1, now - 7 * day, "sent", now - 7 * day),
        step(2, soon, "planned", null),
        step(3, now + 7 * day, "planned", null),
      ],
    },
    {
      ...base("c23", box1, now - 2 * day),
      steps: [
        step(1, now + day, "planned", null),
        step(2, now + 5 * day, "planned", null),
        step(3, now + 12 * day, "planned", null),
      ],
    },
    {
      ...base("c24", box2, now - 13 * day),
      steps: [
        step(1, now - 10 * day, "sent", now - 10 * day),
        step(2, now - 6 * day, "sent", now - 6 * day),
        step(3, now + 4 * day, "planned", null),
      ],
    },
    {
      ...base("c25", box1, now - 75 * 60 * 1000),
      steps: [
        step(1, now + 3 * day, "planned", null),
        step(2, now + 7 * day, "planned", null),
        step(3, now + 14 * day, "planned", null),
      ],
    },
    {
      ...base("c26", box1, now - 4 * day),
      steps: [
        step(1, soon, "planned", null),
        step(2, now + 4 * day, "planned", null),
        step(3, now + 11 * day, "planned", null),
      ],
    },
    // Replied: the sequence stopped by itself.
    {
      ...base("c18", box1, now - 10 * day),
      stopped: "replied",
      steps: [
        step(1, now - 6 * day, "skipped", null),
        step(2, now - 2 * day, "skipped", null),
        step(3, now + 5 * day, "skipped", null),
      ],
    },
    {
      ...base("c20", box1, now - 6 * day),
      stopped: "replied",
      steps: [
        step(1, now - 3 * day, "skipped", null),
        step(2, now + day, "skipped", null),
        step(3, now + 8 * day, "skipped", null),
      ],
    },
    // Parked until January (Latent Lounge) and until spring (Fine-Tune Friday).
    {
      ...base("c19", box1, now - 9 * day),
      parkUntil: now + 79 * day,
      steps: [
        step(1, now + 80 * day, "planned", null),
        step(2, now + 84 * day, "planned", null),
        step(3, now + 91 * day, "planned", null),
      ],
    },
    {
      ...base("c46", box2, now - 20 * day),
      parkUntil: now + 150 * day,
      steps: [
        step(1, now + 151 * day, "planned", null),
        step(2, now + 155 * day, "planned", null),
        step(3, now + 162 * day, "planned", null),
      ],
    },
  ];
}

function proposal(
  why: string,
  summary: string,
  stage: "first" | "reply",
  replyType: string | null,
  gates: DraftProposal["gates"] = [],
): DraftProposal {
  return {
    status: gates.length > 0 ? "needs_human" : "ready",
    why,
    rules: [],
    findings: [],
    gates,
    situation: { side: "creator", stage, replyType, summary },
    model: "gemini",
  };
}

/** Two more first emails (the contact creators) and two answers to replies, waiting for a person. */
export function moreDrafts(now: number): readonly ExampleDraft[] {
  const base = { followUp: null, state: "ready", mailbox: box1 } as const;
  return [
    {
      ...base,
      id: "dr4",
      creator: id("c27"),
      kind: "first",
      replyTo: null,
      at: now - 2 * hour - 30 * 60 * 1000,
      subject: "A support inbox that runs itself",
      body: 'Hi Ally,\n\n"My whole support inbox runs itself now" at 3:05 is the line I keep repeating to people. Solo founders are the exact buyers our AI workflow brands want to reach.\n\nWe are looking to pair you with brands like Inboxly and Agentic HQ for November integrations. Open to hearing the details?\n\nMoustafa, Gratovo',
      proposal: proposal(
        "Quotes the strongest line from the latest video, uses truthful brand wording and asks one easy question.",
        "Cold first email to an AI creator who builds agent stacks for solo founders",
        "first",
        null,
      ),
    },
    {
      ...base,
      id: "dr5",
      creator: id("c28"),
      kind: "first",
      replyTo: null,
      at: now - 2 * hour,
      subject: "Three countries in one prompt",
      body: "Hi Eli,\n\nThe bit at 9:20 where the AI planned three countries in one prompt sold me on the whole van setup. Remote-work builders are right in the sweet spot for our productivity brands.\n\nWe work with Pagewise and Lumen AI and are booking their November creator slots now. Would you be open to a paid integration?\n\nMoustafa, Gratovo",
      proposal: proposal(
        "A specific moment, truthful wording for brands we have won, one easy question.",
        "Cold first email to an AI creator who plans remote work with AI",
        "first",
        null,
      ),
    },
    {
      ...base,
      id: "dr6",
      creator: id("c18"),
      kind: "reply",
      replyTo: "msg31",
      at: now - 20 * hour,
      subject: "Re: Your RAG whiteboard video",
      body: "Hi Sam,\n\nTotally fair. For a channel averaging 40K+ views, a 60-90 second integration usually pays in the $1,200-$1,800 range, and we only bring you developer tools you'd genuinely use on camera so it never reads like an ad.\n\nCould you send a screenshot of your YouTube Studio Audience tab (top countries and age, last 90 days) so we can match your audience to our November brand campaigns?\n\nMoustafa",
      proposal: proposal(
        "They asked about pay and worry about sounding like an ad. Answer with a concrete range, reassure on fit, and say why we ask for analytics.",
        "Interested, first time, asks what it pays",
        "reply",
        "inf.interested_vague",
      ),
    },
    {
      ...base,
      id: "dr7",
      creator: id("c20"),
      kind: "reply",
      replyTo: "msg36",
      at: now - hour,
      subject: "Re: Your Copilot vs Cursor test",
      body: "Hi Ben,\n\nThanks, that is super helpful. $900 for a 60-90 second integration works well as a starting point.\n\nCould you send a quick screenshot of your YouTube Studio Audience tab (top countries and age, last 90 days) so we can match your channel against our November developer brand budgets and bring you a concrete offer this week?\n\nMoustafa",
      proposal: proposal(
        "Accepts the rate as a starting point and says why we want the audience screenshot.",
        "Interested, shared a rate and the audience split",
        "reply",
        "inf.gives_rate",
      ),
    },
  ];
}
