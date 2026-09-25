/*
 * Skills: plain-language instructions the agent follows, kept apart from code so
 * the support team can tune tone and procedure without touching the tools.
 *
 * What a skill can NOT do is grant access: that is decided in code (access.ts,
 * tools.ts) and checked again on the output (validate.ts). A skill that told the
 * model to "share everything" would still hit the same walls.
 */

export interface Skill {
  name: string;
  /** When the skill applies (shown to the model as the section heading). */
  description: string;
  instructions: string;
}

export { voice } from "./voice";
export { privacy } from "./privacy";
export { orders } from "./orders";
export { orderChanges } from "./order-changes";
export { catalog } from "./catalog";
export { handoff } from "./handoff";
export { recovery } from "./recovery";
export { compensation } from "./compensation";
export { payments } from "./payments";
