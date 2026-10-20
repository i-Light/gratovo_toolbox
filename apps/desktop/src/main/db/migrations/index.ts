import type { Migration } from "../migrate";
import { initial } from "./0001-initial";

/** Every migration, numbered 1..n with no gap. Add new ones at the end. */
export const migrations: readonly Migration[] = [initial];
