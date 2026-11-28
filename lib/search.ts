import { z } from "zod";
import { upcomingEvents } from "./club-views";
import { db, transaction } from "./db";
import { assignments, audit, offerings, WorkflowError } from "./assignments";
import { caseKinds, cases } from "./cases";
import { notices } from "./connected";
import { opportunities } from "./opportunities";
import { publishedPolicies } from "./policies";
import { supportServices } from "./support-services";
import type { Scope } from "./scope";

// ID-014: one search box. Each kind is read through its existing reader, so membership, roster, section and audience rules
// are the same as on that kind's own page. This module only scores those already-allowed rows against what was typed:
// whole-word prefixes, related words (built-in list plus the office's own), and pg_trgm for typos in longer words.
export type SearchKind = "Go to" | "Notice" | "College date" | "Club event" | "Opportunity" | "Policy" | "Support service" | "Course" | "Assignment" | "Person" | "Case";
export type SearchHit = { kind: SearchKind; title: string; detail: string; path: string; score?: number };

/** Built-in related words, English and common Kannada transliterations; the office adds its own on the search page. */
export const RELATED: string[][] = [
  ["cie", "ia", "internal assessment", "internal test", "internals"], ["lab", "laboratory", "practical"], ["hod", "head of department"],
  ["bus", "transport", "route", "stop"], ["fee", "fees", "payment", "shulka"], ["leave", "absence", "permission", "raje"],
  ["attendance", "haajari", "hajari"], ["exam", "examination", "pariksha"], ["result", "results", "marks", "grade"],
  ["notice", "circular", "announcement", "suchane"], ["timetable", "schedule", "class"], ["assignment", "homework", "submission"],
  ["holiday", "rajadina"], ["club", "society", "sangha"],
];
const norm = (t: string) => " " + t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
const terms = (q: string) => norm(q).trim().split(" ").filter(t => t.length > 1).slice(0, 6);

// Intent shortcuts: typed phrases that jump straight to a page this role can open.
type Intent = { words: string[]; title: string; path: string; roles?: Scope["role"][] };
const INTENTS: Intent[] = [
  { words: ["attendance", "my attendance"], title: "My attendance", path: "/timetable#attendance", roles: ["student"] },
  { words: ["attendance", "mark attendance"], title: "Record attendance", path: "/timetable", roles: ["faculty"] },
  { words: ["next class", "timetable", "class"], title: "Timetable and next class", path: "/timetable", roles: ["student", "faculty"] },
  { words: ["submit assignment", "assignment", "assignments"], title: "Assignments", path: "/assignments", roles: ["student", "faculty"] },
  { words: ["result", "results", "marks", "grades"], title: "My results", path: "/history", roles: ["student"] },
  { words: ["leave", "letter", "permission"], title: "Leave and permission letters", path: "/letters" },
  { words: ["club", "clubs", "event"], title: "CLUBVERSE", path: "/clubverse", roles: ["student", "faculty", "admin"] },
  { words: ["internship", "placement", "job"], title: "Opportunities", path: "/opportunities", roles: ["student", "admin"] },
  { words: ["help", "support", "counselling"], title: "Support services", path: "/support" },
  { words: ["settings", "language", "password"], title: "Settings", path: "/settings" },
];

/** Scores candidates in one query: every typed word (or a related word) must start a word in the text, or, for words of five
 * or more letters, be a close typo (pg_trgm strict word similarity >= 0.4). Returns [index, score] best first. */
async function rank(groups: string[][], texts: string[]) {
  if (!texts.length || !groups.length) return [] as { i: number; score: number }[];
  return (await db.query<{ i: number; score: number }>(`WITH c AS (SELECT (ord-1)::int AS i,t FROM unnest($1::text[]) WITH ORDINALITY u(t,ord)),
      g AS (SELECT gi,alt FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY x(arr,gi),jsonb_array_elements_text(x.arr) alt),
      s AS (SELECT c.i,g.gi,max(CASE WHEN position(' '||g.alt IN c.t)>0 THEN 1.0
          WHEN length(g.alt)>=5 THEN strict_word_similarity(g.alt,c.t) ELSE 0 END) AS best FROM c CROSS JOIN g GROUP BY c.i,g.gi)
    SELECT i,sum(best)::float8 AS score FROM s GROUP BY i HAVING min(best)>=0.4 AND count(*)=$3 ORDER BY score DESC,i`,
  [texts, JSON.stringify(groups), groups.length])).rows;
}

async function relatedGroups(scope: Scope) {
  const own = (await db.query<{ words: string[] }>("SELECT words FROM search_synonym WHERE institution_id=$1", [scope.institution])).rows.map(r => r.words);
  return [...RELATED, ...own].map(g => g.map(w => norm(w).trim()).filter(Boolean));
}
/** Each typed word plus its related words, as groups that must all match. */
function expand(words: string[], related: string[][]) {
  return words.map(w => [...new Set([w, ...related.filter(g => g.includes(w)).flat()])]);
}
const snippet = (body: string, words: string[]) => {
  const flat = body.replace(/\s+/g, " ").trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(words[0] ?? "") - 40);
  return (at ? "…" : "") + flat.slice(at, at + 160) + (flat.length > at + 160 ? "…" : "");
};

export type SearchResult = { hits: SearchHit[]; didYouMean: string | null };
/** `extra` adds intents the page knows about (Transport once built; Fees for preview users). */
export async function search(scope: Scope, raw: unknown, extra: Intent[] = []): Promise<SearchResult> {
  const q = z.string().trim().min(2).max(120).parse(raw);
  const words = terms(q);
  if (!words.length) return { hits: [], didYouMean: null };
  const [noticeRows, dates, events, listings, policies, services, courses, work, people, caseRows, related] = await Promise.all([
    notices(scope, "published", 200),
    db.query<{ id: string; title: string; kind: string; starts_on: string; ends_on: string }>(`SELECT e.id,e.title,e.kind,to_char(e.starts_on,'DD Mon YYYY') AS starts_on,
        to_char(e.ends_on,'DD Mon YYYY') AS ends_on FROM calendar_entry e
      WHERE e.institution_id=$1 AND e.withdrawn_at IS NULL AND e.ends_on >= current_date - 30
        AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
      ORDER BY e.starts_on LIMIT 200`, [scope.institution, scope.account, scope.role]).then(r => r.rows),
    upcomingEvents(scope, 200),
    scope.role === "student" || scope.role === "admin" ? opportunities(scope, { query: "", page: 1 }).then(r => r.rows) : Promise.resolve([]),
    publishedPolicies(scope),
    supportServices(scope),
    offerings(scope),
    assignments(scope),
    visiblePeople(scope),
    Promise.all(caseKinds[scope.role].map(kind => cases(scope, kind))).then(r => r.flat()),
    relatedGroups(scope),
  ]);
  const candidates: (SearchHit & { text: string })[] = [];
  const add = (hit: SearchHit, ...fields: (string | null | undefined)[]) => candidates.push({ ...hit, text: norm(fields.join(" ")) });
  for (const n of noticeRows) add({ kind: "Notice", title: n.title, detail: `${n.audience} · ${snippet(n.body, words)}`, path: `/notices#notice-${n.id}` }, n.title, n.body, n.kind === "operational" ? "maintenance closure" : "");
  for (const d of dates) add({ kind: "College date", title: d.title, detail: d.starts_on === d.ends_on ? d.starts_on : `${d.starts_on} to ${d.ends_on}`, path: "/calendar" }, d.title, d.kind);
  for (const e of events) add({ kind: "Club event", title: e.title, detail: `${e.club} · ${e.starts} · ${e.location}`, path: `/clubverse/${e.club_id}` }, e.title, e.club, e.location);
  for (const o of listings) add({ kind: "Opportunity", title: o.title, detail: `${o.kind} · ${o.sponsor} · apply by ${o.deadline}`, path: "/opportunities" }, o.title, o.sponsor, o.eligibility, o.kind);
  for (const p of policies) add({ kind: "Policy", title: `${p.title} (version ${p.version})`, detail: snippet(p.body, words), path: "/policies" }, p.title, p.body);
  for (const v of services) add({ kind: "Support service", title: v.name, detail: `${v.contact} · ${v.hours}`, path: "/support" }, v.name, v.description, v.category);
  for (const c of courses) add({ kind: "Course", title: c.course, detail: `${c.section} · ${c.term}`, path: `/courses/${c.id}` }, c.course, c.section, c.term);
  for (const a of work) add({ kind: "Assignment", title: a.title, detail: `${a.course} · ${a.section}`, path: `/assignments/${a.id}` }, a.title, a.course, a.description);
  for (const p of people) add({ kind: "Person", title: p.name, detail: p.detail, path: p.path }, p.name, p.detail);
  for (const k of caseRows) add({ kind: "Case", title: k.title, detail: `${k.kind.replace(/_/g, " ")} · ${k.state.replace("_", " ")}`, path: `/cases?kind=${k.kind}` }, k.title, k.kind.replace(/_/g, " "));
  for (const it of [...INTENTS.filter(i => !i.roles || i.roles.includes(scope.role)), ...extra])
    add({ kind: "Go to", title: it.title, detail: "Open the page", path: it.path }, it.title, ...it.words);

  const groups = expand(words, related);
  const ranked = await rank(groups, candidates.map(c => c.text));
  const hits = ranked.map(r => ({ ...candidates[r.i], score: r.score + (candidates[r.i].kind === "Go to" ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, 60).map(({ kind, title, detail, path, score }) => ({ kind, title, detail, path, score }));
  return { hits, didYouMean: hits.length ? null : await suggest(words, candidates.map(c => c.text)) };
}

/** On a miss, the closest word that does appear in what this person may see. */
async function suggest(words: string[], texts: string[]) {
  const vocabulary = [...new Set(texts.join(" ").split(" ").filter(w => w.length > 3))].slice(0, 5000);
  if (!vocabulary.length) return null;
  const fixed = await Promise.all(words.map(async w => (await db.query<{ w: string }>(`SELECT v AS w FROM unnest($1::text[]) v
    WHERE similarity($2,v) >= 0.25 ORDER BY similarity($2,v) DESC,v LIMIT 1`, [vocabulary, w])).rows[0]?.w ?? w));
  const phrase = fixed.join(" ");
  return phrase === words.join(" ") ? null : phrase;
}

/** People the caller may already see elsewhere: a teacher's current students, a student's current teachers, and for the
 * office every current member. Names and roles only. */
async function visiblePeople(scope: Scope) {
  return (await db.query<{ name: string; detail: string; path: string }>(`SELECT DISTINCT ON (u.id) u.name,
      CASE WHEN $3='admin' THEN m.role ELSE c.name || ' · ' || s.name END AS detail,
      CASE WHEN $3='admin' AND m.role='student' THEN '/admin/students?q=' || u.name || '&student=' || u.id
        WHEN $3='admin' THEN '/admin' ELSE '/courses/' || o.id END AS path
    FROM membership me
    JOIN membership m ON m.institution_id=me.institution_id AND m.ended_at IS NULL
    JOIN "user" u ON u.id=m.account_id
    LEFT JOIN roster mine ON $3 IN ('faculty','student') AND (mine.institution_id,mine.account_id,mine.role)=(me.institution_id,me.account_id,me.role) AND mine.ended_at IS NULL
    LEFT JOIN roster theirs ON (theirs.institution_id,theirs.offering_id)=(mine.institution_id,mine.offering_id) AND theirs.account_id=m.account_id
      AND theirs.role=CASE WHEN $3='faculty' THEN 'student' ELSE 'faculty' END AND theirs.role=m.role AND theirs.ended_at IS NULL
    LEFT JOIN offering o ON (o.institution_id,o.id)=(theirs.institution_id,theirs.offering_id)
    LEFT JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    LEFT JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL AND m.account_id<>$2
      AND ($3='admin' OR theirs.account_id IS NOT NULL)
    ORDER BY u.id,c.name LIMIT 400`, [scope.institution, scope.account, scope.role])).rows;
}

const recentInput = z.string().trim().min(2).max(120);
/** Keeps a person's last eight searches in this workspace. */
export async function rememberSearch(scope: Scope, raw: unknown) {
  const q = recentInput.parse(raw);
  await db.query(`INSERT INTO search_recent (institution_id,account_id,query) SELECT $1,$2,$3
    WHERE EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.ended_at IS NULL)
    ON CONFLICT (institution_id,account_id,query) DO UPDATE SET searched_at=clock_timestamp()`, [scope.institution, scope.account, q]);
  await db.query(`DELETE FROM search_recent WHERE institution_id=$1 AND account_id=$2 AND query NOT IN
    (SELECT query FROM search_recent WHERE institution_id=$1 AND account_id=$2 ORDER BY searched_at DESC LIMIT 8)`, [scope.institution, scope.account]);
}
export async function recentSearches(scope: Scope) {
  return (await db.query<{ query: string }>("SELECT query FROM search_recent WHERE institution_id=$1 AND account_id=$2 ORDER BY searched_at DESC LIMIT 8",
    [scope.institution, scope.account])).rows.map(r => r.query);
}

/** The office's own related-word groups (ID-014). */
export async function relatedWords(scope: Scope) {
  if (scope.role !== "admin") return [];
  return (await db.query<{ id: string; words: string[] }>("SELECT id,words FROM search_synonym WHERE institution_id=$1 ORDER BY created_at", [scope.institution])).rows;
}
const wordsInput = z.string().trim().min(3).max(400).transform(t => [...new Set(t.split(",").map(w => w.trim().toLowerCase()).filter(Boolean))])
  .pipe(z.array(z.string().min(2).max(40)).min(2).max(12));
export function addRelatedWords(scope: Scope, raw: unknown) {
  const words = wordsInput.parse(raw);
  return transaction(async client => {
    const office = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE", [scope.institution, scope.account]);
    if (scope.role !== "admin" || !office.rowCount) throw new WorkflowError("This action is unavailable.");
    const { rows: [row] } = await client.query<{ id: string }>("INSERT INTO search_synonym (institution_id,words,created_by) VALUES ($1,$2,$3) RETURNING id", [scope.institution, words, scope.account]);
    await audit(client, scope, row.id, "search.related_added");
  });
}
export function removeRelatedWords(scope: Scope, raw: unknown) {
  const id = z.uuid().parse(raw);
  return transaction(async client => {
    const office = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE", [scope.institution, scope.account]);
    if (scope.role !== "admin" || !office.rowCount) throw new WorkflowError("This action is unavailable.");
    if (!(await client.query("DELETE FROM search_synonym WHERE institution_id=$1 AND id=$2", [scope.institution, id])).rowCount) throw new WorkflowError("Already removed.");
    await audit(client, scope, id, "search.related_removed");
  });
}
export type { Intent };
