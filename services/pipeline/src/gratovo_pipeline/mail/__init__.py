"""The team's outreach mailbox, as the pipeline sees it.

- `gmail`: talking to Gmail and nothing else. It refreshes an access token, sends one message,
  labels it, and reads a thread back, over Gmail's REST API with the standard library (ADR 0013).
  It holds no state and decides no policy.
- `mailbox`: the pipeline's own record of what was sent and answered (`mailbox.db`): the
  conversations, the send keys that keep a send to once, the replies not yet reported.

Which message to send, and what a reply means, belong to the jobs above these two.
"""
