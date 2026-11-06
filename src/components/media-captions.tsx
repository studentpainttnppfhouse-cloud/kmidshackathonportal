"use client";

import { useEffect, useId, useRef, useState } from "react";
import { saveMediaCaption } from "@/lib/actions/assignments";

export function CaptionField({ assignmentId, language, initial, editable }: {
  assignmentId: string;
  language: "th" | "en";
  initial: string;
  editable: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const saved = useRef(initial);
  const latest = useRef(initial);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!editable || inFlight.current || latest.current === saved.current) return;
    inFlight.current = true;
    setFailed(false);
    setStatus("Saving…");
    try {
      while (latest.current !== saved.current) {
        const caption = latest.current;
        const result = await saveMediaCaption(assignmentId, language, caption);
        if (result.error) throw new Error(result.error);
        saved.current = caption;
      }
      setStatus("Saved");
    } catch {
      setFailed(true);
      setStatus("Couldn’t save. Retry to keep your changes.");
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="hs-label">{language === "th" ? "Thai caption (ภาษาไทย)" : "English caption"}</label>
      <textarea
        id={id}
        lang={language}
        value={value}
        readOnly={!editable}
        maxLength={10000}
        rows={5}
        className="hs-input"
        onChange={(event) => {
          latest.current = event.target.value;
          setValue(latest.current);
          setStatus(latest.current === saved.current ? "" : "Changes pending");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(), 650);
        }}
        onBlur={() => void save()}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="hs-btn hs-btn-secondary"
          disabled={!value}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setStatus("Copied");
            } catch {
              setStatus("Couldn’t copy. Select the caption to copy it.");
            }
          }}
        >
          Copy caption
        </button>
        {editable && failed ? (
          <button type="button" className="hs-btn hs-btn-secondary" onClick={() => void save()}>Retry save</button>
        ) : null}
        <span role="status" className="text-xs text-muted">{status}</span>
      </div>
    </div>
  );
}
