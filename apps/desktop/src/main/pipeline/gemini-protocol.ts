/**
 * The JSON-lines protocol between main and the Gemini bridge (step 3e-3, `.router/PLAN.md` D2, D4).
 *
 * The bridge is a long-lived service, not a job: main sends requests with an `id`, and the bridge
 * answers each one, in any order, plus events. The wire is the old app's (`legacy/pipeline/
 * gemini_bridge/DAEMON.md`), without the drafting actions the decisions build retired.
 *
 * These zod schemas are the source. `gemini-protocol-schema.ts` turns them into the JSON Schema file
 * the pipeline's tests check every line against, as `protocol.ts` does for the jobs.
 */
import { z } from "zod";

/** A reply can carry Gemini's whole answer and its HTML, or a skill's files: far more than a job line. */
export const maxGeminiLineLength = 8 * 1024 * 1024;

/** The port the extension dials. One bridge at a time (the owner's rule). */
export const geminiPort = 8765;

// --- methods ---

/** Extension methods the bridge passes through unchanged (PROTOCOL.md §3; the extension is step 6). */
export const proxiedMethods = [
  "status",
  "diagnostics",
  "get_account",
  "get_model",
  "list_models",
  "set_model",
  "new_chat",
  "send",
  "stop",
  "is_generating",
  "get_last_response",
  "get_conversation",
  "queue_add",
  "queue_list",
  "queue_get",
  "queue_cancel",
  "queue_clear",
  "queue_pause",
  "queue_resume",
  "get_selectors",
  "set_selectors",
  "tabs",
  "open",
  "focus",
  "navigate",
  "switch_account",
  "reload_page",
] as const;

export const bridgeMethods = [
  "bridge.status",
  "bridge.ensure_account",
  "bridge.heal",
  "bridge.open_gem",
  "bridge.ask",
  "bridge.wait",
  "bridge.browser_info",
  "bridge.ensure_window",
  "bridge.install_addon",
  "bridge.shutdown",
] as const;

export const actionMethods = [
  "action.generate_keywords",
  "action.classify_channel",
  "action.gem_create",
  "action.gem_update",
  "action.gem_read",
  "action.skills_list",
  "action.skill_read",
  "action.skill_set_active",
  "action.skill_delete",
  "action.skill_deploy",
  "action.comms_propose",
  "action.comms_check",
] as const;

export const geminiMethods = [...proxiedMethods, ...bridgeMethods, ...actionMethods] as const;
export type GeminiMethod = (typeof geminiMethods)[number];

/** Every code an error may carry: PROTOCOL.md §2, DAEMON.md §2, and the actions' own. */
export const geminiErrorCodes = [
  // the extension's
  "NO_TAB",
  "TAB_NOT_READY",
  "SIGNED_OUT",
  "ELEMENT_NOT_FOUND",
  "GEMINI_ERROR",
  "BUSY",
  "TIMEOUT",
  "SEND_NOT_ACCEPTED",
  "TYPE_FAILED",
  "MODEL_NOT_FOUND",
  "THINKING_NOT_SET",
  "BAD_PARAMS",
  "INTERNAL",
  "GEM_UI_NOT_FOUND",
  "GEM_SAVE_FAILED",
  "MODE_NOT_SET",
  "DROP_FAILED",
  "WORKER_RESTARTED",
  "SKILL_NOT_FOUND",
  "SKILL_FILE_NOT_FOUND",
  "SKILL_UI_NOT_FOUND",
  "SKILL_UPLOAD_FAILED",
  "SKILL_SAVE_FAILED",
  "SKILL_TOGGLE_FAILED",
  "SKILL_DELETE_FAILED",
  // the comms engine's: the answer on the tab follows another prompt
  "WRONG_CHAT",
  // the bridge's
  "EXTENSION_NOT_CONNECTED",
  "ACCOUNT_NOT_FOUND",
  "NO_SUGGESTION",
  "JOB_FAILED",
  "BROWSER_NOT_FOUND",
  "ADDON_UNSIGNED",
  "ADDON_INSTALL_FAILED",
  "BROWSER_LAUNCH_FAILED",
  "NOT_IMPLEMENTED",
  // the actions'
  "ACTION_PARSE_FAILED",
  "ACTION_REFUSED",
  "SKILL_FILE_MISSING",
  "SKILL_INVALID",
  "SKILL_VERIFY_FAILED",
  // a payload without a code the client knows
  "UNKNOWN",
] as const;
export type GeminiErrorCode = (typeof geminiErrorCodes)[number];

// --- main → bridge ---

const requestId = z.string().min(1).max(100);
const details = z.record(z.string(), z.unknown());

export const geminiRequestSchema = z.strictObject({
  id: requestId,
  method: z.enum(geminiMethods),
  params: z.record(z.string(), z.unknown()),
});
export type GeminiRequest = z.infer<typeof geminiRequestSchema>;

// --- bridge → main ---

const responseOk = z.strictObject({
  type: z.literal("response"),
  id: requestId.nullable(),
  ok: z.literal(true),
  result: z.unknown(),
});

const responseError = z.strictObject({
  type: z.literal("response"),
  id: requestId.nullable(),
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum(geminiErrorCodes),
    message: z.string().max(4000),
    details,
  }),
});

export const geminiEventNames = ["daemon", "hello", "job", "status", "log", "progress"] as const;

const eventSchema = z.strictObject({
  type: z.literal("event"),
  event: z.enum(geminiEventNames),
  data: details,
});

export const fromGeminiSchema = z.union([responseOk, responseError, eventSchema]);
export type GeminiLine = z.infer<typeof fromGeminiSchema>;
export type GeminiEvent = z.infer<typeof eventSchema>;

/** The `daemon` event's states (DAEMON.md §1 and "progress events"). */
export const daemonStates = [
  "listening",
  "failed",
  "extension_connected",
  "extension_disconnected",
  "browser_launching",
  "browser_ready",
  "addon_installing",
  "stopped",
] as const;

export const daemonEventDataSchema = z.looseObject({
  state: z.enum(daemonStates),
  port: z.number().int().min(1).max(65_535).optional(),
  pid: z.number().int().min(0).optional(),
  version: z.string().min(1).max(50).optional(),
  reason: z.string().max(200).optional(),
  browser: z.string().max(50).optional(),
  message: z.string().max(2000).optional(),
});

export const progressEventDataSchema = z.looseObject({
  action: z.string().min(1).max(100),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  message: z.string().max(2000),
});

// --- params main sends (strict: main's own messages) ---

const timeoutS = z.number().min(1).max(3600);
const browserId = z.string().min(1).max(50);
const shortList = z.array(z.string().min(1).max(500)).max(1000);

/** Every Gemini-calling action may name a model or gem, and start a new chat (DAEMON.md §3). */
const askCommon = {
  model: z.string().min(1).max(100).optional(),
  gem: z.string().min(1).max(500).optional(),
  newChat: z.boolean().optional(),
  timeoutS: timeoutS.optional(),
};

const empty = z.strictObject({});

// The Comms queue (.router/PLAN.md D6, D10). The request names what to write; the facts are the
// app's side of the case, read by main from its own tables (step 6). Python reads nothing else of
// the app's: channels and videos come from pipeline.db, which it owns.
const recordId = z.string().min(1).max(200);
const email = z.string().min(1).max(320);
const someText = (max: number) => z.string().max(max).nullable();

export const commsKinds = ["first", "reply", "followUp", "decision"] as const;

const commsRequest = z.strictObject({
  kind: z.enum(commsKinds),
  threadId: recordId.optional(),
  channelId: recordId.optional(),
  brandId: recordId.optional(),
  contactEmail: email.optional(),
  // A brand pitch's creators.
  pitchChannelIds: z.array(recordId).max(10).optional(),
  followUpNumber: z.number().int().min(1).max(5).optional(),
  // The Steer panel: knob id → option id, plus "note".
  steer: z.record(z.string().min(1).max(50), z.string().max(2000)).optional(),
  // HC-10 for this case only.
  cashOffer: z.boolean().optional(),
  timeoutS: timeoutS.optional(),
});

const commsFacts = z.strictObject({
  // null: the defaults, as before (placeholders, the incubator claim, IL boycotted).
  agency: z
    .strictObject({
      name: someText(200),
      sender: someText(200),
      whatWeDo: someText(5000),
      website: someText(500),
      trueClaims: z.array(z.string().max(1000)).max(50),
      pastCampaigns: z.array(z.unknown()).max(100),
      incubator: z.boolean(),
      boycott: z.strictObject({
        countries: z.array(z.string().min(1).max(10)).max(300),
        brands: z.array(z.string().min(1).max(200)).max(1000),
      }),
    })
    .nullable(),
  thread: z
    .strictObject({
      id: recordId,
      channelId: recordId.nullable(),
      brandId: recordId.nullable(),
      contactEmail: email.nullable(),
      dealId: recordId.nullable(),
      messages: z
        .array(
          z.strictObject({
            direction: z.enum(["outbound", "inbound"]),
            subject: z.string().max(2000),
            body: z.string().max(100_000),
            at: z.string().max(50),
          }),
        )
        .max(500),
    })
    .nullable(),
  // channel_state by channel id.
  creators: z.record(
    recordId,
    z.strictObject({
      pipelineStage: someText(50),
      mediaKit: z.record(z.string(), z.unknown()).nullable(),
      creatorGender: someText(50),
    }),
  ),
  brand: z
    .strictObject({
      id: recordId,
      name: z.string().max(300),
      website: someText(500),
      category: someText(200),
      country: someText(100),
      campaignBrief: someText(20_000),
      contactName: someText(200),
      contacts: z
        .array(
          z.strictObject({
            name: z.string().max(200).optional(),
            email: z.string().max(320).optional(),
            primary: z.boolean().optional(),
          }),
        )
        .max(100),
    })
    .nullable(),
  // The channel's latest deal; never the brand's price (HC-04), so there is no field for it.
  deal: z
    .strictObject({
      brandName: someText(300),
      stage: someText(50),
      creatorReceives: z.number().min(0).nullable(),
      currency: someText(10),
      deliverables: someText(5000),
      deadline: someText(50),
      paymentTerms: someText(2000),
    })
    .nullable(),
  // Our recent sent emails, newest first, each with its thread (the templated check leaves out
  // the case's own thread, by id).
  recentOutbound: z
    .array(z.strictObject({ threadId: someText(100), body: z.string().max(100_000) }))
    .max(50),
});

export const geminiParamsSchemas = {
  "bridge.status": empty,
  "bridge.browser_info": z.strictObject({ browser: browserId.optional() }),
  "bridge.ensure_window": z.strictObject({
    browser: browserId.optional(),
    focus: z.boolean().optional(),
    timeoutS: timeoutS.optional(),
    url: z.url({ protocol: /^https$/ }).optional(),
  }),
  "bridge.install_addon": z.strictObject({
    browser: browserId.optional(),
    mode: z.enum(["auto", "temporary", "permanent"]).optional(),
    force: z.boolean().optional(),
  }),
  "bridge.ensure_account": z.strictObject({ match: z.string().min(1).max(320) }),
  "bridge.ask": z.strictObject({
    prompt: z.string().min(1).max(500_000),
    interrupt: z.boolean().optional(),
    ...askCommon,
  }),
  "bridge.shutdown": empty,
  "action.generate_keywords": z.strictObject({
    topic: z.string().min(1).max(500),
    count: z.number().int().min(1).max(1000).optional(),
    exclusions: shortList.optional(),
    styles: shortList.optional(),
    language: z.string().min(1).max(50).optional(),
    avoid: z.array(z.string().min(1).max(200)).max(10_000).optional(),
    notes: z.string().max(5000).optional(),
    chats: z.number().int().min(1).max(8).optional(),
    perChat: z.number().int().min(1).max(1000).optional(),
    angles: shortList.optional(),
    ...askCommon,
  }),
  "action.classify_channel": z.strictObject({
    channel: z.strictObject({
      handle: z.string().min(1).max(300),
      title: z.string().max(300).optional(),
      description: z.string().max(10_000).optional(),
      country: z.string().max(2).optional(),
      subscriberCount: z.number().int().min(0).optional(),
      recentVideoTitles: z.array(z.string().max(300)).max(50).optional(),
    }),
    niche: z.string().min(1).max(500),
    criteria: shortList.optional(),
    ...askCommon,
  }),
  "action.gem_create": z.strictObject({
    name: z.string().min(1).max(200),
    description: z.string().max(5000),
    instructions: z.string().max(100_000),
    model: z.string().min(1).max(100).optional(),
    timeoutS: timeoutS.optional(),
  }),
  "action.gem_update": z.strictObject({
    gem: z.string().min(1).max(500),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    instructions: z.string().max(100_000).optional(),
    timeoutS: timeoutS.optional(),
  }),
  "action.gem_read": z.strictObject({
    gem: z.string().min(1).max(500),
    timeoutS: timeoutS.optional(),
  }),
  "action.skills_list": empty,
  "action.skill_read": z.strictObject({
    name: z.string().min(1).max(100),
    contents: z.boolean().optional(),
  }),
  "action.skill_set_active": z.strictObject({
    name: z.string().min(1).max(100),
    active: z.boolean(),
  }),
  "action.skill_delete": z.strictObject({
    name: z.string().min(1).max(100),
    confirm: z.literal(true),
  }),
  "action.skill_deploy": z.strictObject({
    folder: z.string().min(1).max(1024),
    active: z.boolean().optional(),
    verify: z.boolean().optional(),
  }),
  "action.comms_propose": z.strictObject({ request: commsRequest, facts: commsFacts }),
  // The text a person edited, checked again before it goes (no Gemini call).
  "action.comms_check": z.strictObject({
    request: commsRequest,
    facts: commsFacts,
    subject: z.string().max(2000),
    body: z.string().max(100_000),
  }),
} as const satisfies Partial<Record<GeminiMethod, z.ZodType>>;

export type TypedGeminiMethod = keyof typeof geminiParamsSchemas;
export type GeminiParams<M extends TypedGeminiMethod> = z.input<(typeof geminiParamsSchemas)[M]>;

// --- results main reads (loose: an action may add fields, DAEMON.md "progress events") ---

const nullableText = z.string().nullable();
const addonState = z.enum([
  "missing",
  "temporary",
  "installed",
  "outdated",
  "unsigned_blocked",
  "unknown",
]);
const addonMethod = z.enum(["none", "rdp_temporary", "profile_xpi", "policy", "unpacked"]);
const account = z.looseObject({
  name: nullableText.optional(),
  email: nullableText.optional(),
  index: z.number().int().min(0).nullable().optional(),
});
const raw = { raw: z.string(), model: nullableText };
// One thing the comms checks found; `block` stops the message, `warn` is shown to the person.
const commsFinding = z.looseObject({
  code: z.string(),
  severity: z.string(),
  rule: z.string(),
  detail: z.string(),
});
// What a person must confirm before sending (price, terms, a claim, ethics, the model's own).
const commsGate = details;

export const commsStatuses = ["ready", "needs_human", "blocked", "no_message"] as const;

export const geminiResultSchemas = {
  "bridge.status": z.looseObject({
    listening: z.boolean(),
    port: z.number().int(),
    extensionConnected: z.boolean(),
    hello: details.nullable(),
    status: details.nullable(),
    statusError: z.looseObject({ code: z.string(), message: z.string() }).optional(),
  }),
  "bridge.browser_info": z.looseObject({
    selected: z.string(),
    browsers: z.array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        path: nullableText,
        version: nullableText,
        channel: z.string(),
        installed: z.boolean(),
        running: z.boolean(),
        canRunUnsigned: z.boolean(),
      }),
    ),
    addon: z.looseObject({
      id: z.string(),
      shippedVersion: nullableText,
      installedVersion: nullableText,
      state: addonState,
      signed: z.boolean(),
      restartNeeded: z.boolean(),
      method: addonMethod,
      message: z.string(),
    }),
    profile: z.looseObject({
      mode: z.enum(["managed", "existing"]),
      dir: nullableText,
      exists: z.boolean(),
    }),
    extensionDir: nullableText,
    xpiPath: nullableText,
  }),
  "bridge.ensure_window": z.looseObject({
    connected: z.boolean(),
    launched: z.boolean(),
    reused: z.boolean(),
    browser: nullableText,
    addon: z
      .looseObject({ state: addonState, version: nullableText, method: addonMethod })
      .nullable(),
    tab: z.looseObject({ tabId: z.number().int(), url: z.string() }).nullable(),
    account: account.nullable(),
    steps: z.array(
      z.looseObject({
        name: z.string(),
        ok: z.boolean(),
        ms: z.number().min(0),
        detail: z.string().optional(),
      }),
    ),
    message: z.string(),
  }),
  "bridge.install_addon": z.looseObject({
    state: addonState,
    version: nullableText,
    method: addonMethod,
    restartNeeded: z.boolean(),
    message: z.string(),
  }),
  "bridge.ensure_account": account,
  "bridge.ask": z.looseObject({
    text: z.string(),
    html: z.string(),
    model: nullableText,
    // Passed on from the extension, which may leave it out.
    durationMs: z.number().min(0).nullable(),
  }),
  "bridge.shutdown": z.looseObject({ ok: z.literal(true) }),
  "action.generate_keywords": z.looseObject({
    keywords: z.array(z.string()),
    dropped: z.number().int().min(0),
    chats: z
      .array(
        z.looseObject({
          index: z.number().int().min(0),
          requested: z.number().int().min(0),
          received: z.number().int().min(0),
          ok: z.boolean(),
          error: z.unknown(),
          durationMs: z.number().min(0),
        }),
      )
      .optional(),
    partial: z.boolean().optional(),
    ...raw,
  }),
  "action.classify_channel": z.looseObject({
    niche: z.string(),
    audience: z.string(),
    language: z.string(),
    brandFit: z.number().int().min(1).max(5),
    reasons: z.array(z.string()),
    redFlags: z.array(z.string()),
    ...raw,
  }),
  "action.gem_create": z.looseObject({ url: z.string(), gemId: z.string(), name: z.string() }),
  "action.gem_update": z.looseObject({
    url: z.string(),
    gemId: z.string(),
    name: z.string(),
    changed: z.array(z.string()),
  }),
  "action.gem_read": z.looseObject({
    url: z.string(),
    gemId: z.string(),
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
  }),
  "action.skills_list": z.looseObject({
    skills: z.array(
      z.looseObject({
        name: z.string(),
        description: z.string(),
        active: z.boolean(),
        state: z.string(),
      }),
    ),
  }),
  "action.skill_read": details,
  "action.skill_set_active": z.looseObject({
    name: z.string(),
    active: z.boolean(),
    changed: z.boolean(),
  }),
  "action.skill_delete": z.looseObject({ name: z.string(), deleted: z.boolean() }),
  "action.skill_deploy": z.looseObject({
    name: z.string(),
    description: z.string(),
    files: z.array(z.string()),
    sha256: z.string(),
    bytes: z.number().int().min(0),
    zipBytes: z.number().int().min(0),
    hasScripts: z.boolean(),
    mode: z.enum(["create", "replace"]),
    active: z.boolean(),
    verified: z.boolean(),
    // The files the Skills page shows after the upload, or null when it wasn't read back.
    onPage: z.array(z.string()).nullable(),
  }),
  // One proposal for the Comms queue. Nothing is sent: every message waits for a person.
  "action.comms_propose": z.looseObject({
    status: z.enum(commsStatuses),
    proposal: details.nullable(),
    findings: z.array(commsFinding),
    gates: z.array(commsGate),
    case: z.looseObject({ side: z.string(), stage: z.string(), goal: z.string() }),
    moments: z.array(z.unknown()),
    momentsNote: nullableText,
    seconds: z.number().min(0).nullable(),
    model: nullableText,
    thinking: nullableText,
  }),
  "action.comms_check": z.looseObject({
    findings: z.array(commsFinding),
    gates: z.array(commsGate),
    blocking: z.boolean(),
  }),
} as const satisfies Record<TypedGeminiMethod, z.ZodType>;

export type GeminiResult<M extends TypedGeminiMethod> = z.infer<(typeof geminiResultSchemas)[M]>;

// --- lines ---

export type ParsedGeminiLine =
  { ok: true; line: GeminiLine } | { ok: false; problem: "too_long" | "not_json" | "bad_message" };

/** Reads one line the bridge wrote. Never throws. */
export function parseGeminiLine(line: string): ParsedGeminiLine {
  if (line.length > maxGeminiLineLength) {
    return { ok: false, problem: "too_long" };
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, problem: "not_json" };
  }
  const parsed = fromGeminiSchema.safeParse(value);
  return parsed.success ? { ok: true, line: parsed.data } : { ok: false, problem: "bad_message" };
}

/** A request line. Throws if the params break the method's schema: that is main's bug. */
export function geminiRequestLine<M extends TypedGeminiMethod>(
  id: string,
  method: M,
  params: GeminiParams<M>,
): string {
  const checked = geminiParamsSchemas[method].parse(params) as Record<string, unknown>;
  return `${JSON.stringify(geminiRequestSchema.parse({ id, method, params: checked }))}\n`;
}

/** A result checked against its method's schema; `null` when it doesn't fit. */
export function readGeminiResult<M extends TypedGeminiMethod>(
  method: M,
  result: unknown,
): GeminiResult<M> | null {
  const parsed = geminiResultSchemas[method].safeParse(result);
  return parsed.success ? (parsed.data as GeminiResult<M>) : null;
}
