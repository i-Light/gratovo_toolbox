/** Every user-facing string the main process shows, in one place so other languages can follow. */
export const strings = {
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
