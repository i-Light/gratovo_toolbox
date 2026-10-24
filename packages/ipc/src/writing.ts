import { z } from "zod";

/**
 * Settings › Writing rules (plan step 4, D9): the course's playbook rules, read by main from
 * `services/pipeline/data/comms/playbook/rules/*.rules.json`. Read only.
 */

const slug = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const writingRuleLevels = ["must", "should", "tip"] as const;

export const writingRuleSchema = z.strictObject({
  /** Such as "BRD-QUAL-01". */
  id: z
    .string()
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+){1,4}$/)
    .max(40),
  /** The rule file's area: "brand", "influencer", "foundations". */
  area: slug,
  /** Where in the work it applies: "qualify", "first_contact", "negotiation"… */
  stage: slug,
  title: z.string().min(1).max(300),
  rule: z.string().min(1).max(4000),
  level: z.enum(writingRuleLevels),
});

/** `found` is false when the rule files aren't there (a packaged build until step T5). */
export const writingRulesSchema = z.strictObject({
  found: z.boolean(),
  rules: z.array(writingRuleSchema).max(2000),
});
export type WritingRules = z.output<typeof writingRulesSchema>;
