import type { Creator, ContactSource, CreatorStage } from "./types";
import type { CreatorDetails } from "./work-types";

/**
 * The example creators (plan step P1-3, ADR 0021 D5): who they are, what the app knows of them
 * beyond the synced row (`CreatorDetails`) and the facts of their YouTube channel, all about AI
 * creators. The source is the full prototype's roster (`design/workbench-v6/js/data.js`) joined
 * with the creators the example seed had before; times are relative to `now`, so the data is the
 * same on any day.
 *
 * A creator's id is a channel id in the pipeline's shape (`UC` and 22 characters), made from a
 * short key by `exampleChannelId`, so the source below stays readable ("c1") while the database
 * and the Find catalog see one channel.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A 32-bit hash of a text (FNV-1a). */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

/** `length` characters of the YouTube id alphabet, made from `text` alone. */
function scramble(text: string, length: number): string {
  let h = fnv(text);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    out += b64.charAt(h & 63);
  }
  return out;
}

/**
 * The channel id of an example creator: `UC` and 22 characters from the key alone ("c1"), the
 * same every time. The history's channels start `UCZq`; these start `UCSd`, so they never clash.
 */
export function exampleChannelId(key: string): string {
  return `UCSd${scramble(`channel:${key}`, 20)}`;
}

/** The id of video number `index` of a channel: 11 characters of `[A-Za-z0-9_-]`. */
export function exampleVideoId(key: string, index: number): string {
  return scramble(`video:${key}:${String(index)}`, 11);
}

/** One video of an example channel. */
export interface ExampleVideo {
  readonly title: string;
  readonly views: number;
  /** In ms. */
  readonly publishedAt: number;
}

/** What the pipeline knows of an example creator's channel (the Find catalog's row). */
export interface ExampleChannel {
  /** The creator's id (the channel id). */
  readonly id: string;
  readonly subscribers: number;
  /** ISO-2. */
  readonly country: string;
  readonly medianViews: number;
  readonly uploads30: number;
  /** In ms. */
  readonly latestUploadAt: number;
  /** Names of the brands whose sponsored videos were seen. */
  readonly sponsors: readonly string[];
  /** Addresses the search found. */
  readonly emails: readonly string[];
  /** In ms: when the search first found it. */
  readonly foundAt: number;
  /** Newest first, 6 to 12 of them. */
  readonly videos: readonly ExampleVideo[];
}

/** A creator as the seed holds it: the row, its details and its channel. */
export interface ExampleRosterEntry {
  readonly creator: Creator;
  readonly channel: ExampleChannel;
}

/** One roster line before ids and times are worked out. */
interface RosterSpec {
  readonly key: string;
  readonly name: string;
  readonly handle: string;
  readonly stage: CreatorStage;
  readonly creator: {
    readonly email: string | null;
    readonly contactName: string | null;
    readonly emailConfirmed: boolean;
    readonly contactSource: ContactSource | null;
    readonly contactConfidence: number | null;
  };
  readonly details: CreatorDetails;
  readonly channel: {
    readonly subscribers: number;
    readonly country: string;
    readonly medianViews: number;
    readonly uploads30: number;
    readonly sponsors: readonly string[];
    readonly emails: readonly string[];
    readonly foundHoursAgo: number;
    /** Title, views, days ago: the newest first. */
    readonly videos: readonly (readonly [string, number, number])[];
  };
}

/** Titles for the videos added after the first three of each creator (all in the AI niche). */
const moreTitles: readonly string[] = [
  "The AI tools I stopped using this year",
  "Answering your questions about AI agents",
  "My full AI workflow, start to finish",
  "I tested every new AI release this month",
  "What I got wrong about AI last year",
  "Prompts that saved me hours this week",
  "Behind the scenes: how I plan an AI video",
  "A beginner's guide to running models locally",
  "Reading your comments on AI and jobs",
  "The AI news you missed this week",
  "Three AI automations worth setting up today",
  "Can AI really replace a junior hire?",
  "How I check an AI tool before I recommend it",
  "AI tools for small teams, ranked",
  "What changed in AI this quarter",
  "My honest review after 90 days",
  "Setting up an AI assistant for client work",
  "Ten AI shortcuts nobody shows you",
  "Why my AI project failed, and what I fixed",
  "Building with AI on a budget",
  "Live: fixing a broken AI workflow",
  "The AI features I actually use every day",
  "A week of AI tools, no editing out the failures",
  "AI model showdown: same task, four answers",
];

/** How far each added video's views sit from the channel's median. */
const spread: readonly number[] = [1.18, 0.92, 1.06, 0.81, 1.27, 0.97, 0.88, 1.11, 0.76];

function videosOf(spec: RosterSpec, now: number): readonly ExampleVideo[] {
  const base = spec.channel.videos.map(([title, views, ago]) => ({
    title,
    views,
    publishedAt: now - ago * DAY - 2 * HOUR,
  }));
  const total = 6 + (fnv(spec.key) % 6);
  const last = spec.channel.videos[spec.channel.videos.length - 1];
  const gap = Math.min(12, Math.max(2, Math.round(30 / Math.max(1, spec.channel.uploads30))));
  let ago = last === undefined ? 0 : last[2];
  const used = new Set(base.map((v) => v.title));
  const start = fnv(`${spec.key}:titles`) % moreTitles.length;
  for (let i = 0; base.length < total; i += 1) {
    ago += gap + (i % 3);
    const title = moreTitles[(start + i * 5) % moreTitles.length] ?? "";
    if (used.has(title)) continue;
    used.add(title);
    const factor = spread[i % spread.length] ?? 1;
    base.push({
      title,
      views: Math.round((spec.channel.medianViews * factor) / 100) * 100,
      publishedAt: now - ago * DAY - 2 * HOUR,
    });
  }
  return base;
}

/**
 * The roster at `now`: every example creator with its details and channel, in the order the
 * seed lists them (the first sixteen are the creators the seed always had).
 */
export function exampleRoster(now: number): readonly ExampleRosterEntry[] {
  return rosterSpecs(now).map((spec) => {
    const id = exampleChannelId(spec.key);
    const videos = videosOf(spec, now);
    const newest = videos[0];
    return {
      creator: {
        id,
        name: spec.name,
        handle: spec.handle,
        stage: spec.stage,
        ...spec.creator,
        rejectReason: null,
        rejectedAt: null,
        neverReason: null,
        archiveDueAt: null,
        kit: null,
        details: spec.details,
      },
      channel: {
        id,
        subscribers: spec.channel.subscribers,
        country: spec.channel.country,
        medianViews: spec.channel.medianViews,
        uploads30: spec.channel.uploads30,
        latestUploadAt: newest?.publishedAt ?? now,
        sponsors: spec.channel.sponsors,
        emails: spec.channel.emails,
        foundAt: now - spec.channel.foundHoursAgo * HOUR,
        videos,
      },
    };
  });
}

function rosterSpecs(now: number): readonly RosterSpec[] {
  const d = (days: number): number => now + days * DAY;
  const ago = (days: number): number => now - days * DAY;
  return [
    {
      key: "c1",
      name: "Prompt Lab",
      handle: "@promptlab",
      stage: "signed",
      creator: {
        email: "hello@promptlab.tv",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: "brokered",
        lastUpdateAt: ago(3),
        locks: [
          {
            category: "voice",
            brand: "VoxCraft",
            until: d(28),
          },
        ],
        nextOpenSlot: d(9),
        onboarding: {
          dreamBrands: ["Codewell", "Agentic HQ", "Clipforge"],
          hardNos: ["Crypto", "Gambling"],
          paymentRail: "PayPal",
          taxForm: "W-9 on file",
        },
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@promptlab",
          instagram: "@promptlab",
        },
      },
      channel: {
        subscribers: 182000,
        country: "US",
        medianViews: 64000,
        uploads30: 6,
        sponsors: ["VoxCraft", "Pagewise"],
        emails: ["hello@promptlab.tv"],
        foundHoursAgo: 1776,
        videos: [
          ["I let 5 AI agents run my week", 71000, 3],
          ["The AI calendar that finally works", 58000, 9],
          ["Building a CRM in one hour, live", 49000, 15],
        ],
      },
    },
    {
      key: "c2",
      name: "Neural Notes",
      handle: "@neuralnotes",
      stage: "signed",
      creator: {
        email: "team@neuralnotes.io",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u2",
        relationship: "brokered",
        lastUpdateAt: ago(12),
        locks: [
          {
            category: "writing",
            brand: "Lumen AI",
            until: d(36),
          },
        ],
        nextOpenSlot: d(11),
        onboarding: {
          dreamBrands: ["Lumen AI", "VoxCraft", "Pagewise"],
          hardNos: ["Crypto", "Gambling", "Adult"],
          paymentRail: "Wise",
          taxForm: "W-9 on file",
        },
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@neuralnotes",
          instagram: "@neuralnotes",
        },
      },
      channel: {
        subscribers: 96000,
        country: "US",
        medianViews: 52000,
        uploads30: 4,
        sponsors: ["Lumen AI"],
        emails: ["team@neuralnotes.io"],
        foundHoursAgo: 1464,
        videos: [
          ["Notion vs Obsidian with AI, 30 days later", 61000, 5],
          ["My second brain runs on 3 prompts", 44000, 12],
          ["AI summaries saved me 4 hours a week", 52000, 20],
        ],
      },
    },
    {
      key: "c3",
      name: "Code with Kai",
      handle: "@codewithkai",
      stage: "signed",
      creator: {
        email: "kai@codewithkai.dev",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: "exclusive_25",
        lastUpdateAt: ago(4),
        locks: [
          {
            category: "code",
            brand: "Codewell",
            until: d(46),
          },
        ],
        nextOpenSlot: d(14),
        onboarding: {
          dreamBrands: ["Inboxly", "Slidecraft", "Codewell"],
          hardNos: ["Crypto", "Gambling", "Adult", "Unverified VPNs"],
          paymentRail: "Bank transfer",
          taxForm: "W-9 on file",
        },
        format: "long_form",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@codewithkai",
          instagram: "@codewithkai",
        },
      },
      channel: {
        subscribers: 240000,
        country: "US",
        medianViews: 88000,
        uploads30: 5,
        sponsors: ["Codewell"],
        emails: ["kai@codewithkai.dev"],
        foundHoursAgo: 2160,
        videos: [
          ["I built a SaaS in a weekend with Cursor", 96000, 4],
          ["Claude Code vs Copilot: one real project", 83000, 11],
          ["41 minutes to a working login page", 77000, 19],
        ],
      },
    },
    {
      key: "c4",
      name: "Tensor Talk",
      handle: "@tensortalk",
      stage: "signed",
      creator: {
        email: "biz@tensortalk.com",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: "brokered",
        lastUpdateAt: ago(2),
        locks: [],
        nextOpenSlot: d(12),
        onboarding: {
          dreamBrands: ["Agentic HQ", "Clipforge", "Lumen AI"],
          hardNos: ["Crypto", "Gambling"],
          paymentRail: "Wise",
          taxForm: "W-8BEN on file",
        },
        format: "long_form",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@tensortalk",
          instagram: "@tensortalk",
        },
      },
      channel: {
        subscribers: 310000,
        country: "US",
        medianViews: 120000,
        uploads30: 3,
        sponsors: ["Clipforge", "VoxCraft"],
        emails: ["biz@tensortalk.com"],
        foundHoursAgo: 2880,
        videos: [
          ["Every AI video tool, ranked", 146000, 6],
          ["This one cut my edit time in half", 112000, 14],
          ["The open-source model nobody talks about", 98000, 25],
        ],
      },
    },
    {
      key: "c5",
      name: "The AI Desk",
      handle: "@theaidesk",
      stage: "signed",
      creator: {
        email: "desk@theaidesk.news",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u2",
        relationship: "exclusive_25",
        lastUpdateAt: ago(5),
        locks: [],
        nextOpenSlot: d(6),
        onboarding: {
          dreamBrands: ["VoxCraft", "Pagewise", "Inboxly"],
          hardNos: ["Crypto", "Gambling", "Adult"],
          paymentRail: "PayPal",
          taxForm: "W-9 on file",
        },
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@theaidesk",
          instagram: "@theaidesk",
        },
      },
      channel: {
        subscribers: 150000,
        country: "US",
        medianViews: 58000,
        uploads30: 8,
        sponsors: ["Pagewise", "Lumen AI"],
        emails: ["desk@theaidesk.news"],
        foundHoursAgo: 1920,
        videos: [
          ["This week in AI: 9 launches that matter", 64000, 2],
          ["The only launch I would actually pay for", 59000, 9],
          ["AI news, minus the hype", 55000, 16],
        ],
      },
    },
    {
      key: "c11",
      name: "Model Matters",
      handle: "@modelmatters",
      stage: "new",
      creator: {
        email: "modelmatters.yt@gmail.com",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@modelmatters",
          instagram: "@modelmatters",
        },
      },
      channel: {
        subscribers: 67000,
        country: "US",
        medianViews: 49000,
        uploads30: 6,
        sponsors: ["Codewell"],
        emails: ["modelmatters.yt@gmail.com"],
        foundHoursAgo: 2.2,
        videos: [
          ["Claude vs GPT for coding, honest results", 58000, 1],
          ["Benchmarks lie: test models yourself", 49000, 8],
          ["Which model for which job", 46000, 15],
        ],
      },
    },
    {
      key: "c12",
      name: "Prompt Daily",
      handle: "@promptdaily",
      stage: "new",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "high",
          note: "Generic 2-word comment clusters & 2.1% engagement",
        },
        socials: {
          x: "@promptdaily",
          instagram: "@promptdaily",
        },
      },
      channel: {
        subscribers: 43000,
        country: "IN",
        medianViews: 12000,
        uploads30: 2,
        sponsors: [],
        emails: [],
        foundHoursAgo: 2.2,
        videos: [
          ["100 prompts in 10 minutes", 14000, 12],
          ["ChatGPT tricks part 47", 11000, 26],
          ["Make money with AI (real)", 9000, 33],
        ],
      },
    },
    {
      key: "c6",
      name: "Agent Weekly",
      handle: "@agentweekly",
      stage: "contact",
      creator: {
        email: "hello@agentweekly.ai",
        contactName: "Jonas",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@agentweekly",
          instagram: "@agentweekly",
        },
      },
      channel: {
        subscribers: 118000,
        country: "US",
        medianViews: 54000,
        uploads30: 6,
        sponsors: ["Lumen AI"],
        emails: ["hello@agentweekly.ai"],
        foundHoursAgo: 288,
        videos: [
          ["I Let an AI Agent Run My Inbox for a Week", 61000, 4],
          ["Agents That Book Their Own Meetings", 52000, 11],
          ["Why My Agent Failed at Taxes", 47000, 18],
        ],
      },
    },
    {
      key: "c7",
      name: "LLM Lowdown",
      handle: "@llmlowdown",
      stage: "contact",
      creator: {
        email: "partners@llmlowdown.com",
        contactName: "Ravi",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@llmlowdown",
          instagram: "@llmlowdown",
        },
      },
      channel: {
        subscribers: 96000,
        country: "IN",
        medianViews: 47000,
        uploads30: 5,
        sponsors: ["Codewell"],
        emails: ["partners@llmlowdown.com"],
        foundHoursAgo: 336,
        videos: [
          ["Five Open Models You Can Run on a Laptop", 58000, 5],
          ["Quantization Without the Math", 46000, 13],
          ["Benchmarks I Actually Trust", 41000, 21],
        ],
      },
    },
    {
      key: "c13",
      name: "Token Tuesday",
      handle: "@tokentuesday",
      stage: "contact",
      creator: {
        email: "hi@tokentuesday.ai",
        contactName: "Dana",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@tokentuesday",
          instagram: "@tokentuesday",
        },
      },
      channel: {
        subscribers: 84000,
        country: "GB",
        medianViews: 50000,
        uploads30: 4,
        sponsors: ["Pagewise"],
        emails: ["hi@tokentuesday.ai"],
        foundHoursAgo: 360,
        videos: [
          ["Which AI Model Reviews Code Best?", 63000, 3],
          ["Pull Request Review Showdown", 51000, 10],
          ["My Cheapest Coding Setup", 44000, 17],
        ],
      },
    },
    {
      key: "c8",
      name: "Ship AI",
      handle: "@shipai",
      stage: "emailed",
      creator: {
        email: "team@shipai.dev",
        contactName: "Mia",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@shipai",
          instagram: "@shipai",
        },
      },
      channel: {
        subscribers: 71000,
        country: "US",
        medianViews: 44000,
        uploads30: 5,
        sponsors: ["Clipforge"],
        emails: ["team@shipai.dev"],
        foundHoursAgo: 216,
        videos: [
          ["Shipping an AI Feature in a Weekend", 52000, 4],
          ["What Broke in Production", 44000, 12],
          ["Prompt Versioning for Small Teams", 39000, 20],
        ],
      },
    },
    {
      key: "c9",
      name: "Diffusion Diaries",
      handle: "@diffusiondiaries",
      stage: "emailed",
      creator: {
        email: "biz@diffusiondiaries.com",
        contactName: "Theo",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@diffusiondiaries",
          instagram: "@diffusiondiaries",
        },
      },
      channel: {
        subscribers: 132000,
        country: "US",
        medianViews: 56000,
        uploads30: 6,
        sponsors: ["VoxCraft", "Clipforge"],
        emails: ["biz@diffusiondiaries.com"],
        foundHoursAgo: 264,
        videos: [
          ["Four Image Models, One Prompt", 66000, 3],
          ["Fixing Hands, Round Three", 54000, 11],
          ["My Image Workflow in 2026", 48000, 19],
        ],
      },
    },
    {
      key: "c10",
      name: "Vector Vlog",
      handle: "@vectorvlog",
      stage: "replied",
      creator: {
        email: "hi@vectorvlog.io",
        contactName: "Noor",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@vectorvlog",
          instagram: "@vectorvlog",
        },
      },
      channel: {
        subscribers: 63000,
        country: "US",
        medianViews: 41000,
        uploads30: 5,
        sponsors: ["Lumen AI"],
        emails: ["hi@vectorvlog.io"],
        foundHoursAgo: 336,
        videos: [
          ["Vector Databases in 10 Minutes", 49000, 5],
          ["Embeddings, Explained Slowly", 41000, 13],
          ["Search Without Keywords", 37000, 21],
        ],
      },
    },
    {
      key: "c14",
      name: "AgentWorks",
      handle: "@agentworks",
      stage: "kit",
      creator: {
        email: "hello@agentworks.ai",
        contactName: "Elena",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@agentworks",
          instagram: "@agentworks",
        },
      },
      channel: {
        subscribers: 128000,
        country: "US",
        medianViews: 67000,
        uploads30: 5,
        sponsors: ["Codewell"],
        emails: ["hello@agentworks.ai"],
        foundHoursAgo: 720,
        videos: [
          ["I gave an agent my inbox for a week", 79000, 4],
          ["It unsubscribed me from 212 newsletters", 64000, 10],
          ["Agents that actually save time", 58000, 18],
        ],
      },
    },
    {
      key: "c15",
      name: "Silicon Sage",
      handle: "@siliconsage",
      stage: "kit",
      creator: {
        email: "team@siliconsage.io",
        contactName: "Arjun",
        emailConfirmed: true,
        contactSource: "video",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@siliconsage",
          instagram: "@siliconsage",
        },
      },
      channel: {
        subscribers: 88000,
        country: "IN",
        medianViews: 39000,
        uploads30: 6,
        sponsors: [],
        emails: ["team@siliconsage.io"],
        foundHoursAgo: 624,
        videos: [
          ["The AI tools I actually pay for", 42000, 3],
          ["Free AI tools that beat paid ones", 39000, 10],
          ["My AI setup as a student", 35000, 17],
        ],
      },
    },
    {
      key: "c16",
      name: "Context Window",
      handle: "@contextwindow",
      stage: "kit",
      creator: {
        email: "hi@contextwindow.dev",
        contactName: "Sam",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@contextwindow",
          instagram: "@contextwindow",
        },
      },
      channel: {
        subscribers: 58000,
        country: "US",
        medianViews: 43000,
        uploads30: 5,
        sponsors: [],
        emails: ["hi@contextwindow.dev"],
        foundHoursAgo: 312,
        videos: [
          ["What Happens When You Fill the Context Window", 51000, 4],
          ["Long Context vs RAG", 43000, 12],
          ["Needle in a Haystack, For Real", 38000, 20],
        ],
      },
    },
    {
      key: "c17",
      name: "Agent Arena",
      handle: "@agentarena",
      stage: "signed",
      creator: {
        email: "hi@agentarena.gg",
        contactName: "Jonas",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.95,
      },
      details: {
        owner: "u1",
        relationship: "brokered",
        lastUpdateAt: ago(14),
        locks: [],
        nextOpenSlot: d(8),
        onboarding: {
          dreamBrands: ["Slidecraft", "Codewell", "Agentic HQ"],
          hardNos: ["Crypto", "Gambling", "Adult", "Unverified VPNs"],
          paymentRail: "Wise",
          taxForm: "W-9 on file",
        },
        format: "long_form",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@agentarena",
          instagram: "@agentarena",
        },
      },
      channel: {
        subscribers: 140000,
        country: "US",
        medianViews: 61000,
        uploads30: 4,
        sponsors: [],
        emails: ["hi@agentarena.gg"],
        foundHoursAgo: 960,
        videos: [
          ["5 agents race to build an app", 88000, 5],
          ["Which coding agent actually ships?", 61000, 13],
          ["I made agents argue about my startup", 47000, 21],
        ],
      },
    },
    {
      key: "c18",
      name: "Build with LLMs",
      handle: "@buildwithllms",
      stage: "replied",
      creator: {
        email: "contact@buildwithllms.dev",
        contactName: "Sam",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.93,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@buildwithllms",
          instagram: "@buildwithllms",
        },
      },
      channel: {
        subscribers: 74000,
        country: "US",
        medianViews: 41000,
        uploads30: 7,
        sponsors: [],
        emails: ["contact@buildwithllms.dev"],
        foundHoursAgo: 336,
        videos: [
          ["RAG explained with one whiteboard", 52000, 6],
          ["Fine-tuning is not what you need", 41000, 12],
          ["My LLM app costs $3 a month", 38000, 19],
        ],
      },
    },
    {
      key: "c19",
      name: "Latent Lounge",
      handle: "@latentlounge",
      stage: "replied",
      creator: {
        email: "collab@latentlounge.ai",
        contactName: "Mia",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.95,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@latentlounge",
          instagram: "@latentlounge",
        },
      },
      channel: {
        subscribers: 112000,
        country: "US",
        medianViews: 48000,
        uploads30: 5,
        sponsors: [],
        emails: ["collab@latentlounge.ai"],
        foundHoursAgo: 360,
        videos: [
          ["Fine-tuning a 7B model on my laptop", 57000, 7],
          ["Local LLMs, one year in", 46000, 15],
          ["Why I stopped paying for ChatGPT", 51000, 23],
        ],
      },
    },
    {
      key: "c20",
      name: "Copilot Corner",
      handle: "@copilotcorner",
      stage: "replied",
      creator: {
        email: "hello@copilotcorner.com",
        contactName: "Ben",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.96,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@copilotcorner",
          instagram: "@copilotcorner",
        },
      },
      channel: {
        subscribers: 81000,
        country: "US",
        medianViews: 46000,
        uploads30: 6,
        sponsors: [],
        emails: ["hello@copilotcorner.com"],
        foundHoursAgo: 288,
        videos: [
          ["Copilot vs Cursor: 30 day test", 62000, 4],
          ["AI pair programming, honestly", 44000, 11],
          ["The settings I change on every AI editor", 39000, 18],
        ],
      },
    },
    {
      key: "c21",
      name: "Pixel Diffusion",
      handle: "@pixeldiffusion",
      stage: "emailed",
      creator: {
        email: "studio@pixeldiffusion.art",
        contactName: "Ines",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.96,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "long_form",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@pixeldiffusion",
          instagram: "@pixeldiffusion",
        },
      },
      channel: {
        subscribers: 205000,
        country: "US",
        medianViews: 73000,
        uploads30: 4,
        sponsors: ["Clipforge"],
        emails: ["studio@pixeldiffusion.art"],
        foundHoursAgo: 216,
        videos: [
          ["Midjourney v8 vs the open models", 82000, 2],
          ["Hands, finally solved?", 69000, 9],
          ["I trained a style model on my art", 61000, 16],
        ],
      },
    },
    {
      key: "c22",
      name: "Token Talks",
      handle: "@tokentalks",
      stage: "emailed",
      creator: {
        email: "tokentalks.yt@gmail.com",
        contactName: "Ravi",
        emailConfirmed: true,
        contactSource: "video",
        contactConfidence: 0.91,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@tokentalks",
          instagram: "@tokentalks",
        },
      },
      channel: {
        subscribers: 67000,
        country: "US",
        medianViews: 45000,
        uploads30: 5,
        sponsors: [],
        emails: ["tokentalks.yt@gmail.com"],
        foundHoursAgo: 384,
        videos: [
          ["I spent $500 on AI APIs so you don't", 58000, 5],
          ["Cheapest way to run GPT-class models", 47000, 13],
          ["Token prices are collapsing", 43000, 20],
        ],
      },
    },
    {
      key: "c23",
      name: "Gradient Guy",
      handle: "@gradientguy",
      stage: "emailed",
      creator: {
        email: "gradientguy@proton.me",
        contactName: "Leo",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.92,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@gradientguy",
          instagram: "@gradientguy",
        },
      },
      channel: {
        subscribers: 59000,
        country: "US",
        medianViews: 46000,
        uploads30: 4,
        sponsors: [],
        emails: ["gradientguy@proton.me"],
        foundHoursAgo: 192,
        videos: [
          ["Backprop explained with pizza", 51000, 6],
          ["Transformers in 12 minutes", 48000, 14],
          ["What a GPU actually does", 42000, 22],
        ],
      },
    },
    {
      key: "c24",
      name: "Bot Builder",
      handle: "@botbuilder",
      stage: "emailed",
      creator: {
        email: "team@botbuilder.dev",
        contactName: "Ola",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.95,
      },
      details: {
        owner: "u2",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@botbuilder",
          instagram: "@botbuilder",
        },
      },
      channel: {
        subscribers: 101000,
        country: "US",
        medianViews: 52000,
        uploads30: 6,
        sponsors: [],
        emails: ["team@botbuilder.dev"],
        foundHoursAgo: 480,
        videos: [
          ["My AI support bot answered 4,000 tickets", 63000, 8],
          ["Bots that don't annoy customers", 49000, 16],
          ["No-code agents, tested", 45000, 24],
        ],
      },
    },
    {
      key: "c25",
      name: "Diffusion Daily",
      handle: "@diffusiondaily",
      stage: "emailed",
      creator: {
        email: "hey@diffusiondaily.co",
        contactName: "Noor",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.94,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@diffusiondaily",
          instagram: "@diffusiondaily",
        },
      },
      channel: {
        subscribers: 77000,
        country: "US",
        medianViews: 50000,
        uploads30: 9,
        sponsors: [],
        emails: ["hey@diffusiondaily.co"],
        foundHoursAgo: 120,
        videos: [
          ["Flux vs Midjourney, blind test", 57000, 3],
          ["Prompting for product photos", 50000, 10],
          ["Every image model this month", 46000, 17],
        ],
      },
    },
    {
      key: "c26",
      name: "Vector Vibes",
      handle: "@vectorvibes",
      stage: "emailed",
      creator: {
        email: "vectorvibes@outlook.com",
        contactName: "Ana",
        emailConfirmed: true,
        contactSource: "video",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u3",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@vectorvibes",
          instagram: "@vectorvibes",
        },
      },
      channel: {
        subscribers: 64000,
        country: "US",
        medianViews: 47000,
        uploads30: 5,
        sponsors: [],
        emails: ["vectorvibes@outlook.com"],
        foundHoursAgo: 168,
        videos: [
          ["Vector databases in 8 minutes", 54000, 4],
          ["Search that understands meaning", 47000, 12],
          ["I rebuilt Google for my notes", 44000, 19],
        ],
      },
    },
    {
      key: "c27",
      name: "Agentic Ally",
      handle: "@agentically",
      stage: "contact",
      creator: {
        email: "ally@agentically.co",
        contactName: "Ally",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.95,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@agentically",
          instagram: "@agentically",
        },
      },
      channel: {
        subscribers: 54000,
        country: "US",
        medianViews: 46000,
        uploads30: 7,
        sponsors: [],
        emails: ["ally@agentically.co"],
        foundHoursAgo: 72,
        videos: [
          ["My agent stack for a one-person business", 49000, 3],
          ["Agents for solo founders", 46000, 10],
          ["The $20 AI stack", 41000, 17],
        ],
      },
    },
    {
      key: "c28",
      name: "Neural Nomad",
      handle: "@neuralnomad",
      stage: "contact",
      creator: {
        email: "hello@neuralnomad.travel",
        contactName: "Eli",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.93,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@neuralnomad",
          instagram: "@neuralnomad",
        },
      },
      channel: {
        subscribers: 92000,
        country: "US",
        medianViews: 51000,
        uploads30: 6,
        sponsors: [],
        emails: ["hello@neuralnomad.travel"],
        foundHoursAgo: 96,
        videos: [
          ["Running a business from a van with AI", 58000, 5],
          ["AI travel planning, tested", 51000, 12],
          ["Remote work tools I'd keep", 47000, 20],
        ],
      },
    },
    {
      key: "c29",
      name: "AutoFlow Daily",
      handle: "@autoflowdaily",
      stage: "shortlisted",
      creator: {
        email: "autoflowdaily@gmail.com",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@autoflowdaily",
          instagram: "@autoflowdaily",
        },
      },
      channel: {
        subscribers: 58000,
        country: "US",
        medianViews: 47000,
        uploads30: 9,
        sponsors: [],
        emails: ["autoflowdaily@gmail.com"],
        foundHoursAgo: 48,
        videos: [
          ["12 Zapier + AI automations I use daily", 52000, 2],
          ["This one replaced a part-time hire", 47000, 9],
          ["Automate your inbox in 10 minutes", 44000, 16],
        ],
      },
    },
    {
      key: "c30",
      name: "Bytewise AI",
      handle: "@bytewiseai",
      stage: "shortlisted",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@bytewiseai",
          instagram: "@bytewiseai",
        },
      },
      channel: {
        subscribers: 91000,
        country: "US",
        medianViews: 55000,
        uploads30: 5,
        sponsors: ["Lumen AI"],
        emails: [],
        foundHoursAgo: 24,
        videos: [
          ["The AI note-taker test: 6 apps, 1 meeting", 61000, 4],
          ["Two of them invented action items", 55000, 11],
          ["Meeting notes that write themselves", 50000, 18],
        ],
      },
    },
    {
      key: "c31",
      name: "Inference Inc",
      handle: "@inferenceinc",
      stage: "shortlisted",
      creator: {
        email: "team@inference.inc",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@inferenceinc",
          instagram: "@inferenceinc",
        },
      },
      channel: {
        subscribers: 73000,
        country: "US",
        medianViews: 49000,
        uploads30: 4,
        sponsors: [],
        emails: ["team@inference.inc"],
        foundHoursAgo: 24,
        videos: [
          ["Why your AI app is slow (and the 3 fixes)", 53000, 5],
          ["Caching LLM calls the right way", 49000, 13],
          ["Latency budgets for AI products", 44000, 21],
        ],
      },
    },
    {
      key: "c32",
      name: "Prompt Craft",
      handle: "@promptcraft",
      stage: "shortlisted",
      creator: {
        email: "promptcraft.studio@gmail.com",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u3",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@promptcraft",
          instagram: "@promptcraft",
        },
      },
      channel: {
        subscribers: 48000,
        country: "US",
        medianViews: 45000,
        uploads30: 8,
        sponsors: [],
        emails: ["promptcraft.studio@gmail.com"],
        foundHoursAgo: 24,
        videos: [
          ["The prompt pattern nobody uses", 49000, 3],
          ["Prompts that write prompts", 45000, 10],
          ["I tested 100 prompt tips", 42000, 17],
        ],
      },
    },
    {
      key: "c33",
      name: "Vector Shop",
      handle: "@vectorshop",
      stage: "new",
      creator: {
        email: "vectorshop@proton.me",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@vectorshop",
          instagram: "@vectorshop",
        },
      },
      channel: {
        subscribers: 112000,
        country: "US",
        medianViews: 61000,
        uploads30: 5,
        sponsors: ["Pagewise", "Lumen AI", "Sheetsmith"],
        emails: ["vectorshop@proton.me"],
        foundHoursAgo: 2.1,
        videos: [
          ["I replaced my CRM with an AI spreadsheet", 72000, 3],
          ["Spreadsheets that think", 61000, 10],
          ["My AI ops stack", 55000, 17],
        ],
      },
    },
    {
      key: "c34",
      name: "Synth Studio",
      handle: "@synthstudio",
      stage: "new",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@synthstudio",
          instagram: "@synthstudio",
        },
      },
      channel: {
        subscribers: 88000,
        country: "US",
        medianViews: 36000,
        uploads30: 3,
        sponsors: ["VoxCraft"],
        emails: [],
        foundHoursAgo: 2.1,
        videos: [
          ["AI voices that fooled my family", 41000, 5],
          ["Cloning my voice, ethically", 36000, 16],
          ["Text to song, tested", 31000, 27],
        ],
      },
    },
    {
      key: "c35",
      name: "Deep Learning Dad",
      handle: "@dldad",
      stage: "new",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@dldad",
          instagram: "@dldad",
        },
      },
      channel: {
        subscribers: 132000,
        country: "US",
        medianViews: 23000,
        uploads30: 1,
        sponsors: [],
        emails: [],
        foundHoursAgo: 2.1,
        videos: [
          ["Teaching my kids about neural nets", 26000, 21],
          ["A dad's guide to AI homework", 22000, 48],
          ["Should kids use ChatGPT?", 19000, 70],
        ],
      },
    },
    {
      key: "c36",
      name: "LLM Lab Notes",
      handle: "@llmlabnotes",
      stage: "new",
      creator: {
        email: "notes@llmlab.dev",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@llmlabnotes",
          instagram: "@llmlabnotes",
        },
      },
      channel: {
        subscribers: 71000,
        country: "US",
        medianViews: 52000,
        uploads30: 6,
        sponsors: [],
        emails: ["notes@llmlab.dev"],
        foundHoursAgo: 2,
        videos: [
          ["I read every AI paper this week", 61000, 2],
          ["Evals explained without math", 52000, 9],
          ["The paper that changes agents", 49000, 16],
        ],
      },
    },
    {
      key: "c37",
      name: "AI Shorts Daily",
      handle: "@aishortsdaily",
      stage: "new",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "shorts",
        botRisk: {
          level: "high",
          note: "Shorts farm: 4.3% view-to-sub ratio & 1.6% engagement",
        },
        socials: {
          x: "@aishortsdaily",
          instagram: "@aishortsdaily",
        },
      },
      channel: {
        subscribers: 205000,
        country: "US",
        medianViews: 9000,
        uploads30: 31,
        sponsors: [],
        emails: [],
        foundHoursAgo: 2,
        videos: [
          ["This AI is insane", 12000, 0],
          ["ChatGPT secret mode", 8000, 1],
          ["AI did my homework", 9000, 1],
        ],
      },
    },
    {
      key: "c38",
      name: "Workflow Wizard",
      handle: "@workflowwizard",
      stage: "new",
      creator: {
        email: "wizard@workflowwizard.io",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@workflowwizard",
          instagram: "@workflowwizard",
        },
      },
      channel: {
        subscribers: 62000,
        country: "US",
        medianViews: 48000,
        uploads30: 7,
        sponsors: ["Inboxly"],
        emails: ["wizard@workflowwizard.io"],
        foundHoursAgo: 2,
        videos: [
          ["My 7 AI automations for client work", 55000, 3],
          ["Make.com vs Zapier with AI", 48000, 11],
          ["Automations that broke (and fixes)", 44000, 18],
        ],
      },
    },
    {
      key: "c39",
      name: "The Agent Shop",
      handle: "@theagentshop",
      stage: "new",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@theagentshop",
          instagram: "@theagentshop",
        },
      },
      channel: {
        subscribers: 93000,
        country: "US",
        medianViews: 58000,
        uploads30: 5,
        sponsors: [],
        emails: [],
        foundHoursAgo: 2,
        videos: [
          ["I hired 3 AI agents for my store", 66000, 4],
          ["Shopify + agents: what works", 58000, 12],
          ["The agent that answers DMs", 51000, 19],
        ],
      },
    },
    {
      key: "c40",
      name: "Data Dojo",
      handle: "@datadojo",
      stage: "new",
      creator: {
        email: "sensei@datadojo.academy",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "long_form",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@datadojo",
          instagram: "@datadojo",
        },
      },
      channel: {
        subscribers: 118000,
        country: "US",
        medianViews: 54000,
        uploads30: 4,
        sponsors: [],
        emails: ["sensei@datadojo.academy"],
        foundHoursAgo: 1.9,
        videos: [
          ["SQL with AI: 10x faster?", 59000, 5],
          ["Data analysis with one prompt", 54000, 13],
          ["AI for analysts, honestly", 50000, 21],
        ],
      },
    },
    {
      key: "c41",
      name: "Ollama Ollie",
      handle: "@ollamaollie",
      stage: "new",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@ollamaollie",
          instagram: "@ollamaollie",
        },
      },
      channel: {
        subscribers: 52000,
        country: "US",
        medianViews: 46000,
        uploads30: 6,
        sponsors: [],
        emails: [],
        foundHoursAgo: 1.9,
        videos: [
          ["Local AI on a $300 mini PC", 51000, 3],
          ["Ollama setup in 5 minutes", 46000, 10],
          ["Private AI for your family", 43000, 17],
        ],
      },
    },
    {
      key: "c42",
      name: "Crypto AI Signals",
      handle: "@cryptoaisignals",
      stage: "rejected",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@cryptoaisignals",
          instagram: "@cryptoaisignals",
        },
      },
      channel: {
        subscribers: 41000,
        country: "NG",
        medianViews: 15000,
        uploads30: 12,
        sponsors: [],
        emails: [],
        foundHoursAgo: 48,
        videos: [
          ["AI picks the next 100x coin", 17000, 1],
          ["My trading bot made $4,000", 14000, 4],
          ["Signals for this week", 12000, 6],
        ],
      },
    },
    {
      key: "c43",
      name: "AI Gossip Hour",
      handle: "@aigossiphour",
      stage: "rejected",
      creator: {
        email: null,
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "long_form",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@aigossiphour",
          instagram: "@aigossiphour",
        },
      },
      channel: {
        subscribers: 36000,
        country: "US",
        medianViews: 8000,
        uploads30: 3,
        sponsors: [],
        emails: [],
        foundHoursAgo: 48,
        videos: [
          ["Which AI CEO is lying?", 9000, 3],
          ["AI drama of the week", 8000, 10],
          ["The OpenAI rumour", 7000, 17],
        ],
      },
    },
    {
      key: "c44",
      name: "Hype Machine AI",
      handle: "@hypemachineai",
      stage: "never",
      creator: {
        email: "ops@hypemachine.ai",
        contactName: null,
        emailConfirmed: false,
        contactSource: null,
        contactConfidence: null,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic developer comment threads verified",
        },
        socials: {
          x: "@hypemachineai",
          instagram: "@hypemachineai",
        },
      },
      channel: {
        subscribers: 150000,
        country: "US",
        medianViews: 40000,
        uploads30: 9,
        sponsors: [],
        emails: ["ops@hypemachine.ai"],
        foundHoursAgo: 1440,
        videos: [
          ["AI will replace you (here's how)", 44000, 2],
          ["10 AI side hustles", 41000, 9],
          ["The AI bubble", 39000, 16],
        ],
      },
    },
    {
      key: "c45",
      name: "Open Weights Weekly",
      handle: "@openweightsweekly",
      stage: "audience",
      creator: {
        email: "hello@openweights.dev",
        contactName: "Kira",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u1",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@openweightsweekly",
          instagram: "@openweightsweekly",
        },
      },
      channel: {
        subscribers: 109000,
        country: "US",
        medianViews: 57000,
        uploads30: 5,
        sponsors: ["Codewell", "Agentic HQ"],
        emails: ["hello@openweights.dev"],
        foundHoursAgo: 432,
        videos: [
          ["Open Weights, Explained Weekly", 61000, 3],
          ["Running a 70B Model at Home", 57000, 10],
          ["Which Open Model Should You Pick?", 52000, 17],
        ],
      },
    },
    {
      key: "c46",
      name: "Fine-Tune Friday",
      handle: "@finetunefriday",
      stage: "parked",
      creator: {
        email: "team@finetunefriday.io",
        contactName: "Hugo",
        emailConfirmed: true,
        contactSource: "about",
        contactConfidence: 0.9,
      },
      details: {
        owner: "u2",
        relationship: null,
        lastUpdateAt: null,
        locks: [],
        nextOpenSlot: null,
        onboarding: null,
        format: "talking_head",
        botRisk: {
          level: "clean",
          note: "Organic comment threads verified",
        },
        socials: {
          x: "@finetunefriday",
          instagram: "@finetunefriday",
        },
      },
      channel: {
        subscribers: 69000,
        country: "US",
        medianViews: 45000,
        uploads30: 4,
        sponsors: [],
        emails: ["team@finetunefriday.io"],
        foundHoursAgo: 480,
        videos: [
          ["Fine-Tuning Without a PhD", 50000, 5],
          ["LoRA in Plain English", 44000, 13],
          ["My Dataset Mistakes", 40000, 22],
        ],
      },
    },
  ];
}
