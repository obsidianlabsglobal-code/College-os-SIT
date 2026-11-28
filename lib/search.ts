import { z } from "zod";
import { db } from "./db";
import { notices } from "./connected";
import { opportunities } from "./opportunities";
import { publishedPolicies } from "./policies";
import { supportServices } from "./support-services";
import type { Scope } from "./scope";

// One search box. Each kind is read through its existing reader, so membership, roster, section and audience rules are
// the same as on that kind's own page; this module only filters by the words typed.
export type SearchHit = { kind: "Notice" | "College date" | "Club event" | "Opportunity" | "Policy" | "Support service"; title: string; detail: string; path: string };

const terms = (q: string) => q.toLowerCase().split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}]/gu, "")).filter(t => t.length > 1).slice(0, 6);
const matches = (words: string[], ...fields: (string | null | undefined)[]) => {
  const text = fields.join(" ").toLowerCase();
  return words.every(w => text.includes(w));
};
const snippet = (body: string, words: string[]) => {
  const flat = body.replace(/\s+/g, " ").trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(words[0] ?? "") - 40);
  return (at ? "…" : "") + flat.slice(at, at + 160) + (flat.length > at + 160 ? "…" : "");
};

export async function search(scope: Scope, raw: unknown) {
  const q = z.string().trim().min(2).max(120).parse(raw);
  const words = terms(q);
  if (!words.length) return [];
  const [noticeRows, dates, events, listings, policies, services] = await Promise.all([
    notices(scope, "published", 200),
    db.query<{ id: string; title: string; kind: string; starts_on: string; ends_on: string }>(`SELECT e.id,e.title,e.kind,to_char(e.starts_on,'DD Mon YYYY') AS starts_on,
        to_char(e.ends_on,'DD Mon YYYY') AS ends_on FROM calendar_entry e
      WHERE e.institution_id=$1 AND e.withdrawn_at IS NULL AND e.ends_on >= current_date - 30
        AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
      ORDER BY e.starts_on LIMIT 200`, [scope.institution, scope.account, scope.role]).then(r => r.rows),
    // Club events: published and either open to eligible members or the searcher belongs to the club (as on the club page).
    db.query<{ id: string; club_id: string; title: string; location: string; club: string; starts: string }>(`SELECT e.id,e.club_id,e.title,e.location,cp.name AS club,
        to_char(e.starts_at AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY, HH12:MI AM') AS starts FROM club_event e JOIN club c ON (c.institution_id,c.id)=(e.institution_id,e.club_id)
        JOIN club_proposal cp ON (cp.institution_id,cp.id)=(c.institution_id,c.id)
      WHERE e.institution_id=$1 AND c.state='active' AND e.published_at IS NOT NULL
        AND e.state IN ('published','registration_open','registration_closed','in_progress') AND e.ends_at > clock_timestamp()
        AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
        AND (e.audience='eligible' OR $3='admin' OR EXISTS (SELECT 1 FROM club_member cm WHERE (cm.institution_id,cm.club_id)=(e.institution_id,e.club_id)
          AND cm.account_id=$2 AND cm.state='active'))
      ORDER BY e.starts_at LIMIT 200`, [scope.institution, scope.account, scope.role]).then(r => r.rows),
    scope.role === "student" || scope.role === "admin" ? opportunities(scope, { query: "", page: 1 }).then(r => r.rows) : Promise.resolve([]),
    publishedPolicies(scope),
    supportServices(scope),
  ]);
  const hits: SearchHit[] = [];
  for (const n of noticeRows) if (matches(words, n.title, n.body)) hits.push({ kind: "Notice", title: n.title, detail: `${n.audience} · ${snippet(n.body, words)}`, path: `/notices#notice-${n.id}` });
  for (const d of dates) if (matches(words, d.title, d.kind)) hits.push({ kind: "College date", title: d.title, detail: d.starts_on === d.ends_on ? d.starts_on : `${d.starts_on} to ${d.ends_on}`, path: "/calendar" });
  for (const e of events) if (matches(words, e.title, e.club, e.location)) hits.push({ kind: "Club event", title: e.title, detail: `${e.club} · ${e.starts} · ${e.location}`, path: `/clubverse/${e.club_id}` });
  for (const o of listings) if (matches(words, o.title, o.sponsor, o.eligibility, o.kind)) hits.push({ kind: "Opportunity", title: o.title, detail: `${o.kind} · ${o.sponsor} · apply by ${o.deadline}`, path: "/opportunities" });
  for (const p of policies) if (matches(words, p.title, p.body)) hits.push({ kind: "Policy", title: `${p.title} (version ${p.version})`, detail: snippet(p.body, words), path: "/policies" });
  for (const s of services) if (matches(words, s.name, s.description, s.category)) hits.push({ kind: "Support service", title: s.name, detail: `${s.contact} · ${s.hours}`, path: "/support" });
  return hits.slice(0, 60);
}
