import { initials } from "@gratovo/ui";
import { useState } from "react";

/** Where main serves a picture from (plan D9): the page never reaches a remote address. */
const imageBase = "app://gratovo/img/";

/** The address of a picture key such as `v:<videoId>` or `c:<channelId>`. */
export function imageUrl(pic: string): string {
  return `${imageBase}${pic}`;
}

/**
 * Remembers which key failed, so a new key gets a fresh try. A failed picture (main answers 404 for
 * example data and for anything it couldn't fetch) turns into the placeholder.
 */
function useBroken(pic: string | null): { readonly show: boolean; readonly onError: () => void } {
  const [failed, setFailed] = useState<string | null>(null);
  return {
    show: pic !== null && failed !== pic,
    onError: () => {
      setFailed(pic);
    },
  };
}

/**
 * A video thumbnail in a 16:9 box. Without a picture, or when it fails to load, it shows the
 * channel's initials on the Find hue. `name` is the channel's name; `alt` describes the picture.
 */
export function Thumb({
  pic,
  alt,
  name,
}: {
  readonly pic: string | null;
  readonly alt: string;
  readonly name?: string;
}) {
  const { show, onError } = useBroken(pic);
  return (
    <div className={show ? "thumb" : "thumb pic-ph"}>
      {show && pic !== null ? (
        <img src={imageUrl(pic)} alt={alt} loading="lazy" decoding="async" onError={onError} />
      ) : (
        <span role="img" aria-label={alt}>
          {initials(name ?? alt)}
        </span>
      )}
    </div>
  );
}

/** The round profile picture (a `c:` key), with the same placeholder. */
export function ThumbAvatar({
  pic,
  name,
  alt,
}: {
  readonly pic: string | null;
  readonly name: string;
  readonly alt: string;
}) {
  const { show, onError } = useBroken(pic);
  return show && pic !== null ? (
    <span className="av l">
      <img src={imageUrl(pic)} alt={alt} loading="lazy" decoding="async" onError={onError} />
    </span>
  ) : (
    <span className="av l pic-ph" role="img" aria-label={alt}>
      {initials(name)}
    </span>
  );
}
