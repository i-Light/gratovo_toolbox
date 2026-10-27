import { useKeys } from "../lib/keys";
import { toggleCommenting, usePrototype } from "../lib/prototype";
import { CommentList } from "./comment-list";
import { Picker } from "./picker";
import { Pins } from "./pins";

/**
 * The comment tool. The app mounts it only while prototype mode is on, so with the mode off none
 * of it exists: no key, no pin, no bar. C starts and stops commenting.
 */
export function CommentLayer() {
  const proto = usePrototype();
  useKeys({
    c: () => {
      toggleCommenting();
    },
  });
  return (
    <>
      <Pins showPins={proto.pins || proto.commenting} />
      {proto.commenting ? <Picker /> : null}
      {proto.panel ? <CommentList /> : null}
    </>
  );
}
