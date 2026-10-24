/** Every user-facing string the main process shows, in one place so other languages can follow. */
export const strings = {
  /** The page the browser shows after Google's consent. It reflects nothing from the request. */
  mailConsent: {
    title: "Gratovo",
    done: "You can close this tab and go back to Gratovo.",
    failed:
      "Gratovo couldn't connect this mailbox. You can close this tab and try again in Gratovo.",
  },
  startupFailed: {
    title: "Gratovo Toolbox couldn't start",
    body: "Something went wrong while the app was starting, so it will close. Try opening it again. If it keeps happening, tell the owner.",
  },
  conflict: {
    /** "Your change to @handle clashed with Sara's". */
    text: (label: string, theirName: string): string =>
      `Your change to ${label} clashed with ${theirName}'s`,
    /** "Stage: yours Emailed, theirs Replied". */
    sub: (field: string, mine: string, theirs: string): string =>
      `${field}: yours ${mine}, theirs ${theirs}`,
    someone: "someone",
    /** A creator's stage as people read it (the renderer's `record.stages` say the same). */
    stages: {
      new: "New find",
      shortlisted: "Needs contact",
      contact: "Contact confirmed",
      emailed: "In sequence",
      replied: "Replied",
      kit: "Media kit in",
      audience: "Audience checked",
      signed: "Signed",
      rejected: "Rejected",
      parked: "Parked",
      never: "Never contact",
    } as Readonly<Record<string, string>>,
    fields: {
      creator_stage: "Stage",
      notes: "Notes",
      vetting_status: "Vetting",
      pipeline_stage: "Pipeline stage",
      channel_tags: "Tags",
      relevance_criteria: "Relevance",
      provided_data: "Provided data",
      contacts: "Contacts",
      media_kit: "Media kit",
      creator_gender: "Gender",
    } as Readonly<Record<string, string>>,
  },
  /** The jobs tray's line for the email finder after a shortlist (plan step 5c, D30). */
  emailFinder: {
    running: (n: number): string =>
      n === 1 ? "Finding emails for 1 channel" : `Finding emails for ${String(n)} channels`,
    found: (k: number): string => (k === 1 ? "1 email found" : `${String(k)} emails found`),
    failed: "Couldn’t look up emails",
    /** Why, by the job's end code (the search's words for the same codes). */
    problems: {
      no_youtube_key:
        "The team’s YouTube key is missing or was refused. The owner can set it again.",
      quota: "YouTube’s daily limit is used up. It resets at midnight Pacific time.",
      blocked: "YouTube stopped answering this computer. Wait a few hours, then try again.",
      network: "Couldn’t reach YouTube. Check the connection, then try again.",
      no_python: "The search engine isn’t set up on this computer yet.",
      crash: "The lookup stopped on an error. The details are in the log file.",
    } as Readonly<Record<string, string>>,
  },
  presence: {
    idle: "Idle",
    record: "Looking at a record",
    screens: {
      today: "Today",
      find: "Find",
      reach: "Reach",
      close: "Close",
      deliver: "Deliver",
      insights: "Insights",
      toolbox: "Toolbox",
      team: "Team",
      settings: "Settings",
    } as Readonly<Record<string, string>>,
  },
} as const;
