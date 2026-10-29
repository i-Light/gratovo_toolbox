/**
 * The word lists the example history is made from (plan step P8a). Everything is about AI
 * creators, AI tools and the brands that sponsor them. These are data, not interface strings.
 */

export const namePrefixes: readonly string[] = [
  "Prompt",
  "Tensor",
  "Agent",
  "Local LLM",
  "Neural",
  "Vector",
  "Token",
  "Copilot",
  "Diffusion",
  "Inference",
  "Model",
  "Gradient",
  "Latent",
  "Embedding",
  "Transformer",
  "Fine-tune",
  "RAG",
  "Cursor",
  "Weights",
  "Open Weights",
  "GPU",
  "Pipeline",
  "Synthetic",
  "Robo",
  "Context",
  "Notebook",
  "Python",
  "Quantized",
  "Benchmark",
  "Cloud",
  "Edge",
  "Chatbot",
  "Automation",
  "Workflow",
  "Machine",
  "Deep",
  "Silicon",
  "Binary",
  "Logic",
  "Data",
  "Algo",
  "Bot",
  "Cortex",
  "Signal",
  "Pixel",
  "Voice",
  "Vision",
  "Multimodal",
  "Agentic",
  "Generative",
  "Open Source",
  "Stack",
  "Sandbox",
  "Kernel",
  "Compute",
  "Parameter",
  "Layer",
  "Epoch",
  "Synapse",
  "Neuron",
  "Lambda",
  "Matrix",
  "Sigma",
  "Delta",
  "Zero Shot",
  "Few Shot",
  "Chain of Thought",
  "Mixture",
  "Alignment",
  "Reasoning",
];

export const nameCores: readonly string[] = [
  "Lab",
  "Daily",
  "Weekly",
  "Hub",
  "Explained",
  "Builds",
  "Studio",
  "Club",
  "Notes",
  "Show",
  "Workshop",
  "Academy",
  "Digest",
  "Insider",
  "Playground",
  "Desk",
  "Report",
  "Corner",
  "Files",
  "Radar",
  "Review",
  "Dojo",
  "Garage",
  "Wire",
  "Brief",
  "Cast",
  "TV",
  "Diaries",
  "Talk",
  "Tips",
  "Tricks",
  "Tools",
  "Lessons",
  "School",
  "Guide",
  "Journal",
  "Sessions",
  "Space",
  "Labs",
  "Works",
  "Café",
  "Minute",
  "Weekend",
  "Nights",
  "Tonight",
  "Today",
  "Live",
  "Origin",
  "Loop",
  "Bench",
];

export const nameTails: readonly string[] = [
  "with Sam",
  "by Priya",
  "Co",
  "Pro",
  "101",
  "Live",
  "Extra",
  "Plus",
  "HQ",
  "Official",
  "Reloaded",
  "Junior",
  "for Devs",
  "for Makers",
  "in 10 Minutes",
  "Daily",
  "Weekly",
  "TV",
  "2.0",
  "Unfiltered",
  "Explains",
  "Show",
  "Unplugged",
  "Basics",
  "Deep Dive",
  "Clips",
  "Shorts",
  "Archive",
  "Notes",
  "Express",
];

/** Channels the app should have kept: big, posting often, a US, UK, CA or AU audience, sponsors seen. */
export const likelyMistakes: readonly {
  readonly name: string;
  readonly subscribers: number;
  readonly median: number;
  readonly uploads: number;
  readonly country: string;
  readonly brands: readonly string[];
}[] = [
  {
    name: "Local Model Lab",
    subscribers: 412000,
    median: 168000,
    uploads: 9,
    country: "US",
    brands: ["Lumen AI", "Tensor Cloud"],
  },
  {
    name: "The Agent Builders",
    subscribers: 286000,
    median: 121000,
    uploads: 7,
    country: "GB",
    brands: ["Clipforge", "Pagewise", "Promptly"],
  },
  {
    name: "Inference Weekly",
    subscribers: 905000,
    median: 233000,
    uploads: 5,
    country: "CA",
    brands: ["Vectorly"],
  },
  {
    name: "Open Weights Daily",
    subscribers: 158000,
    median: 97000,
    uploads: 14,
    country: "AU",
    brands: ["Neuronote", "Lumen AI"],
  },
  {
    name: "Prompt and Process",
    subscribers: 342000,
    median: 142000,
    uploads: 8,
    country: "US",
    brands: ["Draftwise", "Modelhub"],
  },
];

/** The (fictional) AI tools that sponsor creators in the example. */
export const sponsorBrands: readonly string[] = [
  "Lumen AI",
  "Clipforge",
  "Pagewise",
  "Tensor Cloud",
  "Promptly",
  "Neuronote",
  "Vectorly",
  "Inferio",
  "Draftwise",
  "Modelhub",
  "Sketchloop",
  "Voxwave",
];

export interface KeywordSpec {
  readonly keyword: string;
  /** How much it finds (relative). */
  readonly find: number;
  /** How well its finds are kept (1 is usual). */
  readonly keep: number;
  /** How likely its emailed creators are to reply (1 is usual). */
  readonly reply: number;
  /** Runs it appears in from this many days ago (null: from the start, or a fixed day). */
  readonly sinceDaysAgo: number | null;
}

/** The 41 keywords. The story is in `find`, `keep`, `reply` and the signings in example-history.ts. */
export const keywordSpecs: readonly KeywordSpec[] = [
  { keyword: "ai news weekly", find: 12, keep: 0.6, reply: 0, sinceDaysAgo: null },
  { keyword: "local llm setup", find: 7, keep: 2.3, reply: 2.6, sinceDaysAgo: null },
  { keyword: "ai agents tutorial", find: 7, keep: 2.1, reply: 2.3, sinceDaysAgo: null },
  { keyword: "cursor ai coding", find: 5, keep: 1.8, reply: 1.8, sinceDaysAgo: 150 },
  { keyword: "chatgpt tips", find: 6, keep: 0.35, reply: 0.7, sinceDaysAgo: null },
  { keyword: "ai video tools", find: 3, keep: 1, reply: 1, sinceDaysAgo: 21 },
  { keyword: "prompt engineering tutorial", find: 6, keep: 1.2, reply: 1.3, sinceDaysAgo: null },
  { keyword: "ai tools review", find: 6, keep: 0.9, reply: 1, sinceDaysAgo: null },
  { keyword: "stable diffusion workflow", find: 4, keep: 1.1, reply: 1, sinceDaysAgo: null },
  { keyword: "ollama tutorial", find: 3, keep: 1.6, reply: 1.5, sinceDaysAgo: 120 },
  { keyword: "rag tutorial python", find: 3, keep: 1.3, reply: 1.2, sinceDaysAgo: 160 },
  { keyword: "fine tuning llm", find: 3, keep: 1.2, reply: 1.1, sinceDaysAgo: 140 },
  { keyword: "ai coding assistant", find: 4, keep: 1.4, reply: 1.4, sinceDaysAgo: 130 },
  { keyword: "midjourney tips", find: 3, keep: 0.8, reply: 0.9, sinceDaysAgo: null },
  { keyword: "ai automation workflow", find: 4, keep: 1.1, reply: 1.1, sinceDaysAgo: 110 },
  { keyword: "open source llm", find: 3, keep: 1.3, reply: 1.2, sinceDaysAgo: 100 },
  { keyword: "comfyui tutorial", find: 2.5, keep: 1, reply: 1, sinceDaysAgo: 105 },
  { keyword: "ai image generator", find: 3, keep: 0.7, reply: 0.8, sinceDaysAgo: null },
  { keyword: "llm benchmarks", find: 2, keep: 1.2, reply: 1, sinceDaysAgo: 95 },
  { keyword: "langchain tutorial", find: 2.5, keep: 1, reply: 1, sinceDaysAgo: 90 },
  { keyword: "ai productivity apps", find: 3, keep: 0.8, reply: 0.9, sinceDaysAgo: 85 },
  { keyword: "copilot tips", find: 2.5, keep: 1, reply: 1, sinceDaysAgo: 80 },
  { keyword: "claude code workflow", find: 2, keep: 1.5, reply: 1.4, sinceDaysAgo: 60 },
  { keyword: "ai voice cloning", find: 2, keep: 0.9, reply: 1, sinceDaysAgo: 75 },
  { keyword: "ai music generator", find: 2, keep: 0.8, reply: 0.9, sinceDaysAgo: 70 },
  { keyword: "gpt wrapper startup", find: 1.5, keep: 0.9, reply: 1, sinceDaysAgo: 68 },
  { keyword: "vector database explained", find: 1.5, keep: 1.1, reply: 1, sinceDaysAgo: 65 },
  { keyword: "mcp servers tutorial", find: 2, keep: 1.5, reply: 1.5, sinceDaysAgo: 55 },
  { keyword: "ai research papers explained", find: 2, keep: 1, reply: 1, sinceDaysAgo: 58 },
  { keyword: "no code ai apps", find: 2.5, keep: 0.9, reply: 1, sinceDaysAgo: 50 },
  { keyword: "ai tools for creators", find: 2.5, keep: 1, reply: 1.1, sinceDaysAgo: 48 },
  { keyword: "notion ai", find: 1.5, keep: 0.8, reply: 0.9, sinceDaysAgo: 45 },
  { keyword: "ai podcast tools", find: 1.5, keep: 0.9, reply: 1, sinceDaysAgo: 42 },
  { keyword: "text to video ai", find: 2.5, keep: 0.9, reply: 1, sinceDaysAgo: 40 },
  { keyword: "local ai home lab", find: 1.5, keep: 1.3, reply: 1.3, sinceDaysAgo: 38 },
  { keyword: "ai news reaction", find: 2, keep: 0.6, reply: 0.5, sinceDaysAgo: 35 },
  { keyword: "deep learning explained", find: 2, keep: 1, reply: 1, sinceDaysAgo: 32 },
  { keyword: "hugging face tutorial", find: 1.5, keep: 1.2, reply: 1.1, sinceDaysAgo: 30 },
  { keyword: "ai side hustle", find: 2, keep: 0.5, reply: 0.6, sinceDaysAgo: 28 },
  { keyword: "ai for beginners", find: 3, keep: 0.8, reply: 0.9, sinceDaysAgo: 26 },
  { keyword: "gemini tips", find: 2, keep: 0.9, reply: 1, sinceDaysAgo: 24 },
];

export const countries: readonly (readonly [string, number])[] = [
  ["US", 38],
  ["GB", 8],
  ["CA", 5],
  ["AU", 4],
  ["IN", 12],
  ["DE", 4],
  ["FR", 3],
  ["BR", 4],
  ["NG", 2],
  ["PK", 2],
  ["ES", 2],
  ["NL", 2],
  ["SG", 1],
  ["PL", 2],
  ["TR", 2],
  ["ID", 2],
];

export const firstNames: readonly string[] = [
  "Mia",
  "Noor",
  "Jonas",
  "Ravi",
  "Dana",
  "Elena",
  "Arjun",
  "Sam",
  "Leo",
  "Priya",
  "Omar",
  "Hana",
  "Theo",
  "Ines",
  "Kofi",
  "Yuki",
  "Marta",
  "Ben",
  "Aisha",
  "Tomas",
  "Chloe",
  "Dev",
  "Lucia",
  "Nikhil",
  "Zoe",
  "Felix",
  "Amara",
  "Jules",
  "Rosa",
  "Kai",
];

export const mailLocals: readonly string[] = [
  "hello",
  "hi",
  "team",
  "partners",
  "business",
  "collab",
  "contact",
  "sponsors",
];

/** The tail of the creators' addresses. */
export const mailTails: readonly string[] = ["ai", "com", "dev", "io", "tv", "co"];

export const topics: readonly string[] = [
  "running Llama locally",
  "building an AI agent",
  "your Cursor setup",
  "prompt engineering for coders",
  "a RAG pipeline in Python",
  "fine-tuning a small model",
  "the new open-weights release",
  "Stable Diffusion workflows",
  "AI video tools compared",
  "an MCP server walkthrough",
  "ChatGPT for research",
  "a local voice assistant",
  "benchmarking coding models",
  "automating a newsletter with AI",
  "your home GPU lab",
  "vector databases explained",
  "ComfyUI for beginners",
  "AI note-taking apps",
  "a week with an AI pair programmer",
  "text-to-video tools",
];

export const openers: readonly string[] = [
  "I watched your video on {topic} and the middle section stuck with me.",
  "Your latest video on {topic} was the clearest one I have seen this month.",
  "I have been following your channel since the video on {topic}.",
  "The way you walked through {topic} made it easy to follow.",
  "I came across {topic} on your channel and kept watching.",
  "Your take on {topic} is not the usual hype, which is why I am writing.",
];

export const pitches: readonly string[] = [
  "I work with AI tool teams who look for creators with an audience like yours.",
  "We help AI product teams find channels that explain tools honestly.",
  "A few of our clients make AI developer tools and want one honest video each.",
  "We represent brands in the AI space and your audience is the one they ask for.",
  "Some AI startups we work with sponsor channels that show real workflows.",
];

export const asks: readonly string[] = [
  "Would you be open to hearing about a paid sponsorship?",
  "Is this something you would consider, and what is your rate?",
  "Could we send you the details?",
  "Would a short call or a reply here work better for you?",
  "Do you take sponsored videos right now?",
];

export const subjects: readonly string[] = [
  "Your video on {topic}",
  "A question about {topic}",
  "{topic}: a sponsor idea",
  "Quick note on {topic}",
  "Sponsoring your channel",
];

export const followUpLines: readonly string[] = [
  "Just checking this did not get buried. Happy to send details.",
  "A short follow-up in case my first note slipped past you.",
  "One more try: would a sponsored video fit your plans this quarter?",
  "I will keep this brief. Still keen to work with you.",
  "Last note from me on this. The offer stands if the timing changes.",
];

export interface ReplyKind {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly side: string;
  readonly bodies: readonly string[];
}

export const replyKinds: Readonly<Record<string, ReplyKind>> = {
  "inf.interested_vague": {
    id: "inf.interested_vague",
    label: "Interested",
    summary: "Open to it and wants to hear more.",
    side: "creator",
    bodies: [
      "Sounds interesting, tell me more.",
      "Yes, open to this. What would you need from me?",
      "Could be a fit. Send the details over.",
      "Thanks for reaching out, I am curious. What is the brand?",
    ],
  },
  "inf.gives_rate": {
    id: "inf.gives_rate",
    label: "Gives a rate",
    summary: "Names a price for a sponsored video.",
    side: "creator",
    bodies: [
      "A dedicated video is $2,400 for me, integrations $1,200.",
      "My rate for a 60 second integration is $1,500.",
      "Dedicated video starts at $3,000, two week turnaround.",
    ],
  },
  "inf.who_are_you": {
    id: "inf.who_are_you",
    label: "Asks who we are",
    summary: "Wants to know who the agency is and which brands.",
    side: "creator",
    bodies: [
      "Who are you with, and which brands are we talking about?",
      "Can you tell me a bit more about the agency first?",
    ],
  },
  "inf.has_manager": {
    id: "inf.has_manager",
    label: "Has a manager",
    summary: "Points to their manager for business.",
    side: "creator",
    bodies: [
      "Please talk to my manager about this, I have copied her in.",
      "I work through my agent for sponsorships. Their address is below.",
    ],
  },
  "inf.later": {
    id: "inf.later",
    label: "Not now",
    summary: "Interested later, not at the moment.",
    side: "creator",
    bodies: [
      "Not taking sponsors until next quarter, ask me again in January.",
      "Booked up for two months. Come back to me then.",
      "Good timing is the issue. Let us talk after the holidays.",
    ],
  },
  "inf.not_interested": {
    id: "inf.not_interested",
    label: "Not interested",
    summary: "Does not take sponsored videos.",
    side: "creator",
    bodies: [
      "Thanks, but I do not do sponsored content.",
      "Not for me, please take me off your list.",
      "No thanks, I only work with my own affiliates.",
    ],
  },
  "any.out_of_office": {
    id: "any.out_of_office",
    label: "Out of office",
    summary: "An automatic reply: away until a date.",
    side: "none",
    bodies: [
      "I am out of the office until next week and will reply when I am back.",
      "Automatic reply: travelling, limited email access.",
    ],
  },
  "inf.media_kit": {
    id: "inf.media_kit",
    label: "Sends a media kit",
    summary: "Sends their numbers and rates.",
    side: "creator",
    bodies: [
      "My media kit is attached, audience split is on page two.",
      "Here is the kit with this month's numbers.",
    ],
  },
  "inf.agrees": {
    id: "inf.agrees",
    label: "Agrees",
    summary: "Agrees to the terms.",
    side: "creator",
    bodies: ["That works for me, let us do it.", "Agreed. Send over the contract."],
  },
  "any.bounce": {
    id: "any.bounce",
    label: "Bounce",
    summary: "The address does not exist.",
    side: "none",
    bodies: ["The address could not be found, or it is unable to receive mail."],
  },
};

export const answerLines: readonly string[] = [
  "Thanks for the quick answer. Here is what the brand has in mind.",
  "Great, thank you. I will send the brief today.",
  "Appreciate it. Could you share your audience split by country?",
  "That helps. I will come back with a figure by tomorrow.",
  "Thanks. Would a call this week suit you?",
];

export const neverReasons: readonly string[] = [
  "Asked us to stop",
  "Works with a competing agency",
  "Reaction channel, not a fit",
  "Brand safety: off-topic content",
  "Already signed with a network",
  "Said never contact in the About text",
];
