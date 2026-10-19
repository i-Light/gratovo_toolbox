import { freeze, produce } from "immer";
import type { Draft } from "immer";

/** One recorded change, kept so it can be taken back (and put back again). */
export interface UndoStep<D> {
  /** A number that grows with each recorded change, so a toast can tell whether its change is still the newest. */
  readonly id: number;
  /** What the change did, in the words a toast and the activity log show. */
  readonly label: string;
  /** The data as it was before the change. */
  readonly data: D;
  readonly at: number;
}

export interface StoreState<D, U> {
  readonly data: D; // the business: undoable
  readonly ui: U; // where you are: not undoable
}

export interface StoreOptions<D, U> {
  readonly data: D;
  readonly ui: U;
  readonly undoLimit?: number; // default 80; the oldest step drops off
  readonly now?: () => number; // default Date.now
}

export interface Store<D, U> {
  getState(): StoreState<D, U>;
  /** Listeners run after every committed change, in the order they subscribed. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Changes the data and records one undo step. Returns the recipe's result, or false when the recipe
   * returned false: then nothing changes and nothing is recorded (its draft edits are dropped).
   * A recipe that changes nothing records nothing and notifies nobody, but still returns its result.
   * Recording clears the redo list.
   */
  act<R>(label: string, recipe: (data: Draft<D>, ui: U) => R): R | false;
  /** Changes UI state only; never recorded. No change, no notification. */
  ui(recipe: (ui: Draft<U>, data: D) => void): void;
  /**
   * For background jobs: applies the recipe to the current data AND to the data in every undo and
   * redo step, so undoing an older change never removes what a job produced since.
   */
  bg(recipe: (data: Draft<D>) => void): void;
  /** Steps back one change. Returns the step undone (its label is for the toast), or undefined if there is none. */
  undo(): UndoStep<D> | undefined;
  /** Steps forward again. Returns the step redone, or undefined. */
  redo(): UndoStep<D> | undefined;
  /** The newest step Undo would take back, or undefined. */
  peekUndo(): UndoStep<D> | undefined;
  canRedo(): boolean;
}

const defaultUndoLimit = 80;

/**
 * Makes the app's store: business data that can be undone, and UI state that cannot. Changes are
 * written as recipes that mutate a draft (immer), so the data underneath is never edited in place,
 * and an undo step simply keeps the previous data object instead of copying it.
 *
 * Ported from the prototype's `W.act`, `W.ui`, `W.bg`, `W.undo` and `W.redo` (core.js).
 */
export function createStore<D, U>(options: StoreOptions<D, U>): Store<D, U> {
  const undoLimit = options.undoLimit ?? defaultUndoLimit;
  const now = options.now ?? Date.now;

  // Auto-freeze only covers what immer produces, so the starting values are frozen here.
  let state: StoreState<D, U> = { data: freeze(options.data, true), ui: freeze(options.ui, true) };
  let undoSteps: UndoStep<D>[] = [];
  let redoSteps: UndoStep<D>[] = [];
  let nextId = 1;
  let listeners: (() => void)[] = [];

  function notify(): void {
    // A listener may unsubscribe while we run, so walk a copy.
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function setState(data: D, ui: U): void {
    state = { data, ui };
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },

    act<R>(label: string, recipe: (data: Draft<D>, ui: U) => R): R | false {
      let result: R | undefined;
      // The producer always returns undefined, so a recipe that returns false (or anything else)
      // can never become the new state.
      const next = produce(state.data, (draft) => {
        result = recipe(draft, state.ui);
      });
      if (result === false) {
        return false;
      }
      // `result` is set by the recipe above; the cast tells TypeScript what it cannot see.
      const value = result as R;
      if (next === state.data) {
        return value;
      }
      undoSteps.push({ id: nextId, label, data: state.data, at: now() });
      nextId += 1;
      if (undoSteps.length > undoLimit) {
        undoSteps.shift();
      }
      redoSteps = [];
      setState(next, state.ui);
      notify();
      return value;
    },

    ui(recipe) {
      const next = produce(state.ui, (draft) => {
        recipe(draft, state.data);
      });
      if (next === state.ui) {
        return;
      }
      setState(state.data, next);
      notify();
    },

    bg(recipe) {
      const apply = (data: D): D =>
        produce(data, (draft) => {
          recipe(draft);
        });
      const mapSteps = (steps: UndoStep<D>[]): UndoStep<D>[] =>
        steps.map((step) => {
          const stepData = apply(step.data);
          return stepData === step.data ? step : { ...step, data: stepData };
        });
      undoSteps = mapSteps(undoSteps);
      redoSteps = mapSteps(redoSteps);
      const data = apply(state.data);
      // Listeners read the state, so they hear only of a change to the current data.
      if (data === state.data) {
        return;
      }
      setState(data, state.ui);
      notify();
    },

    undo() {
      const step = undoSteps.pop();
      if (step === undefined) {
        return undefined;
      }
      redoSteps.push({ id: step.id, label: step.label, data: state.data, at: now() });
      setState(step.data, state.ui);
      notify();
      return step;
    },

    redo() {
      const step = redoSteps.pop();
      if (step === undefined) {
        return undefined;
      }
      undoSteps.push({ id: step.id, label: step.label, data: state.data, at: now() });
      setState(step.data, state.ui);
      notify();
      return step;
    },

    peekUndo: () => undoSteps[undoSteps.length - 1],

    canRedo: () => redoSteps.length > 0,
  };
}
