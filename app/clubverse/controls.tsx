import type { ReactNode } from "react";
import { ActionForm } from "../forms";
import { clubAction } from "../actions/clubverse";
import type { Scope } from "../../lib/scope";
import type { Proposal, catalogOptions } from "../../lib/club-views";

export function ClubForm({ current, operation, label, values = {}, children }: {
  current: Scope; operation: string; label: string; values?: Record<string,string | number>; children?: ReactNode;
}) {
  return <ActionForm action={clubAction} context={current} operation={operation} label={label}>
    {Object.entries(values).map(([name,value]) => <input key={name} type="hidden" name={name} value={value} />)}
    {children}
  </ActionForm>;
}

export function ProposalFields({ options, draft }: {
  options: Awaited<ReturnType<typeof catalogOptions>>; draft?: Proposal;
}) {
  return <>
    <label>Club name<input name="name" defaultValue={draft?.name} maxLength={120} required /></label>
    <label>Category<select name="category" defaultValue={draft?.category_id}>{options.categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>Template (optional)<select name="template" defaultValue={draft?.template_id ?? ""}><option value="">None</option>
      {options.templates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>Purpose<textarea name="purpose" defaultValue={draft?.purpose} maxLength={4000} required /></label>
    <label>Membership rules and planned activities<textarea name="rules" defaultValue={draft?.rules} maxLength={4000} required /></label>
    <label>Membership policy<select name="joining" defaultValue={draft?.joining ?? "approval"}>
      <option value="approval">Officer approval</option><option value="open">Open joining</option><option value="invitation">Invitation only</option>
    </select></label>
    <label>Audience<select name="audience" defaultValue={draft?.audience ?? "campus"}>
      <option value="campus">Students and faculty</option><option value="students">Students</option><option value="faculty">Faculty</option>
    </select></label>
  </>;
}

export const stateText = (value: string) => value.replaceAll("_"," ");

export function EventFields({ timezone }: { timezone: string }) {
  return <>
    <label>Event title<input name="title" maxLength={140} required /></label>
    <label>Location<input name="location" maxLength={180} required /></label>
    <label>Starts ({timezone})<input name="starts" type="datetime-local" required /></label>
    <label>Ends ({timezone})<input name="ends" type="datetime-local" required /></label>
    <label>Capacity<input name="capacity" type="number" min={1} max={10000} required /></label>
    <label>Event audience<select name="audience"><option value="club">Club members</option><option value="eligible">Eligible students</option></select></label>
    <label>Requirements and event plan<textarea name="requirements" maxLength={4000} required /></label>
  </>;
}
