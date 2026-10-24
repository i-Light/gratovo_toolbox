import type { ChannelResponse } from "@gratovo/ipc";

/** One channel as `find:item` answers it (with the page's stage laid over it). */
export type CreatorDetail = NonNullable<ChannelResponse<"find:item">["item"]>;

const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

/** The channel's page on YouTube, or null when the id is not a real channel id (D25). */
export function channelUrl(id: string): string | null {
  return channelIdPattern.test(id) ? `https://www.youtube.com/channel/${id}` : null;
}

/** A video's page on YouTube, or null when the id is not a real video id (D25). */
export function videoUrl(id: string): string | null {
  return videoIdPattern.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}
