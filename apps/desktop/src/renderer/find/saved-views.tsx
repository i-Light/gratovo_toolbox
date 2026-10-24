import { viewNameMax, type FindFilter, type SavedView } from "@gratovo/core/find";
import { Btn, Icon } from "@gratovo/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "../lib/toast";
import { strings } from "../strings";

const text = strings.findGallery.views;

type SetResult = "saved" | "too_many" | "failed";

/** Stores the whole list of views; the answer says whether main took it. */
async function storeViews(views: readonly SavedView[]): Promise<SetResult> {
  try {
    const result = await window.gratovo.invoke("find:views-set", { views: [...views] });
    if (!result.ok) {
      return "failed";
    }
    return result.value.ok ? "saved" : result.value.problem;
  } catch {
    return "failed";
  }
}

/**
 * The saved views (D20): one chip each, plus "Save this view" when a filter is on. A click brings
 * the filter back; the × takes a view away, and the toast's Undo puts it back where it was.
 */
export function SavedViews({
  filter,
  active,
  onApply,
}: {
  readonly filter: FindFilter;
  /** Whether the filter narrows anything: only then is there something to save. */
  readonly active: boolean;
  readonly onApply: (filter: FindFilter) => void;
}) {
  const [views, setViews] = useState<readonly SavedView[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  // The list as last stored, for the next change to build on even before a re-render.
  const latest = useRef<readonly SavedView[]>([]);
  const mounted = useRef(true);
  const nameBox = useRef<HTMLInputElement>(null);

  // The box opens because the person asked to name a view, so focus goes to it.
  useEffect(() => {
    if (saving) {
      nameBox.current?.focus();
    }
  }, [saving]);

  const show = useCallback((next: readonly SavedView[]): void => {
    latest.current = next;
    if (mounted.current) {
      setViews(next);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    window.gratovo.invoke("find:views", {}).then(
      (result) => {
        if (result.ok && mounted.current) {
          show(result.value.views);
        }
      },
      () => undefined,
    );
    return () => {
      mounted.current = false;
    };
  }, [show]);

  const trimmed = name.trim();

  async function save(): Promise<void> {
    if (trimmed === "") {
      return;
    }
    const next = [...latest.current, { name: trimmed.slice(0, viewNameMax), filter }];
    const result = await storeViews(next);
    if (result === "saved") {
      show(next);
      setSaving(false);
      setName("");
      toast({ msg: text.saved, sub: text.savedSub, icon: "star", tone: "info" });
    } else {
      toast({ msg: result === "too_many" ? text.tooMany : text.saveFailed, icon: "alert" });
    }
  }

  async function remove(index: number): Promise<void> {
    const before = latest.current;
    const gone = before[index];
    if (gone === undefined) {
      return;
    }
    const next = before.filter((_, i) => i !== index);
    show(next);
    if ((await storeViews(next)) !== "saved") {
      show(before);
      toast({ msg: text.saveFailed, icon: "alert" });
      return;
    }
    toast({
      msg: text.removed(gone.name),
      icon: "trash",
      actions: [
        {
          label: text.undo,
          run: () => {
            const without = latest.current;
            const restored = [...without];
            restored.splice(Math.min(index, restored.length), 0, gone);
            show(restored);
            void storeViews(restored).then((again) => {
              if (again !== "saved") {
                show(without);
                toast({ msg: text.saveFailed, icon: "alert" });
              }
            });
          },
        },
      ],
    });
  }

  return (
    <div className="row wrap saved-views" role="group" aria-label={text.title}>
      {views.length > 0 ? <span className="small muted">{text.title}</span> : null}
      {views.map((v, i) => (
        <span key={`${String(i)}:${v.name}`} className="view-chip">
          <button
            type="button"
            className="chip"
            onClick={() => {
              onApply(v.filter);
              toast({ msg: text.apply(v.name), icon: "filter", tone: "info", ms: 2000 });
            }}
          >
            <Icon name="star" size={12} />
            <span className="ell chip-t">{v.name}</span>
          </button>
          <button
            type="button"
            className="view-x"
            aria-label={text.remove(v.name)}
            onClick={() => {
              void remove(i);
            }}
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      {saving ? (
        <span className="row" style={{ gap: "4px" }}>
          <input
            className="inp sm"
            style={{ width: "150px" }}
            ref={nameBox}
            placeholder={text.namePlaceholder}
            aria-label={text.nameLabel}
            maxLength={viewNameMax}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void save();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setSaving(false);
                setName("");
              }
            }}
          />
          <Btn
            size="sm"
            disabled={trimmed === ""}
            onClick={() => {
              void save();
            }}
          >
            {text.saveButton}
          </Btn>
        </span>
      ) : active ? (
        <Btn
          kind="ghost"
          size="sm"
          icon="plus"
          onClick={() => {
            setSaving(true);
          }}
        >
          {text.save}
        </Btn>
      ) : null}
    </div>
  );
}
