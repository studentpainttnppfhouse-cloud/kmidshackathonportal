"use client";

import { useActionState, useEffect, useState } from "react";
import { Modal } from "./modal";
import { Feedback, SubmitButton } from "./form-bits";
import { recordDriveOpen, shareDrive } from "@/lib/actions/workspace";

type Recipient = { id: string; name: string };
export type SharingItem = {
  id: string;
  scope: string;
  departmentId: string | null;
  sharedUserIds: string[];
  sharedDepartmentIds: string[];
};

export function SharingFields({
  item,
  people,
  departments,
}: {
  item?: Omit<SharingItem, "id">;
  people: Recipient[];
  departments: Recipient[];
}) {
  const [scope, setScope] = useState(
    item?.scope === "department" ? "people" : (item?.scope ?? "private"),
  );
  const [query, setQuery] = useState("");
  const matching = (name: string) =>
    name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  return (
    <div className="space-y-4">
      <label className="hs-label">
        Who can access
        <select
          name="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="hs-input"
        >
          <option value="private">Only me</option>
          <option value="people">Selected people and teams</option>
          <option value="all">Everyone in the portal</option>
        </select>
      </label>
      <p className="text-sm text-muted">
        People you share with can read and download. You keep control of
        editing.
      </p>
      <div hidden={scope !== "people"} className="space-y-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find people or teams"
          placeholder="Find a name or department"
          className="hs-input"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="hs-label">Departments</legend>
            <div className="max-h-60 space-y-1 overflow-auto">
              {departments.map((team) => (
                <label
                  key={team.id}
                  hidden={!matching(team.name)}
                  className="min-h-9 items-center gap-2 text-sm [&:not([hidden])]:flex"
                >
                  <input
                    type="checkbox"
                    name="sharedDepartmentIds"
                    value={team.id}
                    defaultChecked={
                      item?.sharedDepartmentIds.includes(team.id) ||
                      (item?.scope === "department" &&
                        item.departmentId === team.id)
                    }
                  />
                  {team.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="hs-label">People</legend>
            <div className="max-h-60 space-y-1 overflow-auto">
              {people.map((person) => (
                <label
                  key={person.id}
                  hidden={!matching(person.name)}
                  className="min-h-9 items-center gap-2 text-sm [&:not([hidden])]:flex"
                >
                  <input
                    type="checkbox"
                    name="sharedUserIds"
                    value={person.id}
                    defaultChecked={item?.sharedUserIds.includes(person.id)}
                  />
                  {person.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}

export function DriveShareButton({
  item,
  people,
  departments,
}: {
  item: SharingItem;
  people: Recipient[];
  departments: Recipient[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(shareDrive.bind(null, item.id), {});
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);
  return (
    <>
      <button
        type="button"
        className="hs-btn hs-btn-secondary"
        onClick={() => setOpen(true)}
      >
        Share
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Share document"
        size="lg"
      >
        <form action={action} className="space-y-4">
          <SharingFields
            item={item}
            people={people}
            departments={departments}
          />
          <Feedback state={state} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="hs-btn hs-btn-secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <SubmitButton>Save sharing</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DriveOpenTracker({ id }: { id: string }) {
  useEffect(() => {
    void recordDriveOpen(id).catch(() => {});
  }, [id]);
  return null;
}
