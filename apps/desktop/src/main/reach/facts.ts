import { engineKit } from "@gratovo/core/close";
import {
  messageBodyMax,
  threadMessagesMax,
  type CreatorKit,
  type DataSource,
} from "@gratovo/core/data";

import type { GeminiParams } from "../pipeline/gemini-protocol";

import { reachStrings } from "./strings";

/**
 * The facts main sends with `action.comms_propose` (plan step 6, D7): the app's side of the case,
 * read from the open source. Python reads nothing else of the app's; channels and videos come from
 * its own `pipeline.db`. Pure apart from the source reads.
 */

export type CommsFacts = GeminiParams<"action.comms_propose">["facts"];

/** What the facts need of the open source. */
export type FactsSource = Pick<DataSource, "creatorStates" | "outreach">;

export interface CommsFactsInput {
  readonly source: FactsSource;
  readonly creatorId: string;
  /** The name drafts are signed with: the mail settings' sender name, else the profile name. */
  readonly sender: string | null;
  /** In ms; the facts carry no time of their own, the messages carry theirs. */
  readonly now: number;
  /**
   * The creator's kit as main reads it (the merged view, `kitView`); the case does not carry it
   * itself. Absent or null: the engine is told there is no kit.
   */
  readonly kit?: CreatorKit | null;
}

/** The conversation key of a creator's thread (D3), also the comms engine's thread id. */
export const threadIdOf = (creatorId: string): string => `c:${creatorId}`;

/** The newest bodies out the templated check compares against. */
export const recentOutboundMax = 20;
/** The engine's boycotted countries (its own default, made explicit). */
export const boycottCountries: readonly string[] = ["IL"];

const cut = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

const cutOrNull = (value: string | null, max: number): string | null =>
  value === null || value === "" ? null : cut(value, max);

export async function buildCommsFacts(input: CommsFactsInput): Promise<CommsFacts> {
  const { source, creatorId, sender, kit = null } = input;
  const states = await source.creatorStates();
  const creator = states.find((state) => state.id === creatorId) ?? null;
  const threadId = threadIdOf(creatorId);
  const messages = source.outreach.thread(creatorId, threadMessagesMax);
  return {
    agency: {
      name: reachStrings.agencyName,
      sender: cutOrNull(sender, 200),
      whatWeDo: null,
      website: null,
      trueClaims: [],
      pastCampaigns: [],
      incubator: true,
      boycott: { countries: [...boycottCountries], brands: [] },
    },
    thread: {
      id: threadId,
      channelId: creatorId,
      brandId: null,
      contactEmail: cutOrNull(creator?.email ?? null, 320),
      dealId: null,
      messages: messages.map((message) => ({
        direction: message.direction === "out" ? "outbound" : "inbound",
        subject: cut(message.subject, 2000),
        body: cut(message.body, messageBodyMax),
        at: new Date(message.at).toISOString(),
      })),
    },
    creators:
      creator === null
        ? {}
        : {
            [creatorId]: {
              pipelineStage: cutOrNull(creator.legacyPipelineStage, 50),
              mediaKit: engineKit(kit, creator.stage === "signed"),
              creatorGender: null,
            },
          },
    brand: null,
    deal: null,
    recentOutbound: source.outreach.recentOutbound(recentOutboundMax).map((sent) => ({
      threadId: cut(threadIdOf(sent.creator), 100),
      body: cut(sent.body, messageBodyMax),
    })),
  };
}
