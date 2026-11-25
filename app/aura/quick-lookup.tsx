import { randomUUID } from "node:crypto";
import { ContextSheet } from "../experience/context-sheet";
import { ActionForm } from "../forms";
import type { Scope } from "../../lib/scope";
import { quickLookup } from "../actions/aura";

export function QuickLookup({current}: {current: Scope}) {
  return <ContextSheet label="Ask AURA" title="Academic lookup">
    <ActionForm action={quickLookup} context={current} label="Check records">
      <input type="hidden" name="nonce" value={randomUUID()} />
      <label>Look up<select name="lookup">
        <option>My timetable</option><option>My assignments</option>
        {current.role === "student" && <option>My attendance</option>}
      </select></label>
      <p className="meta">Read your current records and open the answer in AURA activity.</p>
    </ActionForm>
  </ContextSheet>;
}
