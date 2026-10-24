import { Empty } from "@gratovo/ui";

import { strings } from "../strings";

/** Never contact (D39). A placeholder until the tool is built (task B18). */
export function NeverTool() {
  return <Empty icon="ban" title={strings.toolbox.soon} />;
}
