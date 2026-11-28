// covers: ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { search } from "../lib/search";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = `zq${randomUUID().slice(0, 6)}`;
const club = randomUUID(), events = { members: randomUUID(), open: randomUUID() };
const ids = { sectionNotice: randomUUID(), collegeNotice: randomUUID(), draftNotice: randomUUID(), staffPolicy: randomUUID(), listing: randomUUID(), date: randomUUID() };
const titles = async (alias: string, q = tag) => (await search(as.get(alias)!, q)).map(h => `${h.kind}: ${h.title}`).sort();

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  const admin = as.get("admin")!.account, faculty = as.get("faculty")!.account, principal = as.get("principal")!.account;
  await owner.query(`INSERT INTO notice (institution_id,id,author_id,author_role,offering_id,title,body,published_at) VALUES
    ($1,$2,$3,'faculty',$4,$5,'Fictional: bring your lab record.',now()),($1,$6,$3,'faculty',$4,$7,'Not published yet.',NULL)`,
  [i, ids.sectionNotice, faculty, fixtures.offering, `Section A lab ${tag}`, ids.draftNotice, `Draft ${tag}`]);
  await owner.query("INSERT INTO notice (institution_id,id,author_id,author_role,title,body,published_at) VALUES ($1,$2,$3,'admin',$4,'Fictional circular for everyone.',now())",
    [i, ids.collegeNotice, admin, `Exam circular ${tag}`]);
  await owner.query("INSERT INTO policy (institution_id,id,kind,title,audience,created_by) VALUES ($1,$2,'general',$3,'staff',$4)", [i, ids.staffPolicy, `Staff rule ${tag}`, admin]);
  await owner.query(`INSERT INTO policy_version (institution_id,policy_id,version,body,state,drafted_by,decided_by,decided_at,decision_reason)
    VALUES ($1,$2,1,'Fictional staff-only guidance.','approved',$3,$4,now(),'Approved')`, [i, ids.staffPolicy, admin, principal]);
  await owner.query(`INSERT INTO opportunity_listing (institution_id,id,kind,title,sponsor,eligibility,source_url,deadline,verified_by)
    VALUES ($1,$2,'hackathon',$3,'Fictional Labs','Open to all students.','https://example.org/hack',current_date+10,$4)`, [i, ids.listing, `Hackathon ${tag}`, admin]);
  await owner.query(`INSERT INTO club_proposal (institution_id,id,founder_id,category_id,name,purpose,rules,joining,audience,state)
    VALUES ($1,$2,$3,'technical',$4,'Fictional','Fictional','open','campus','approved')`, [i, club, as.get("student")!.account, `Robotics ${tag}`]);
  await owner.query("INSERT INTO club (institution_id,id) VALUES ($1,$2)", [i, club]);
  await owner.query("INSERT INTO club_member (institution_id,club_id,account_id,state) VALUES ($1,$2,$3,'active')", [i, club, as.get("student")!.account]);
  for (const [id, title, audience] of [[events.members, `Members build night ${tag}`, "club"], [events.open, `Open demo day ${tag}`, "eligible"]])
    await owner.query(`INSERT INTO club_event (institution_id,id,club_id,author_id,title,location,requirements,audience,starts_at,ends_at,capacity,state,published_at)
      VALUES ($1,$2,$3,$4,$5,'Fictional lab','None',$6,now()+interval '2 days',now()+interval '2 days 2 hours',40,'registration_open',now())`,
    [i, id, club, as.get("student")!.account, title, audience]);
  await owner.query("INSERT INTO calendar_entry (institution_id,id,title,kind,starts_on,ends_on,created_by) VALUES ($1,$2,$3,'event',current_date+5,current_date+5,$4)",
    [i, ids.date, `Open day ${tag}`, admin]);
});
after(async () => {
  await owner.query("DELETE FROM club_event WHERE institution_id=$1 AND club_id=$2", [i, club]);
  await owner.query("DELETE FROM club_member WHERE institution_id=$1 AND club_id=$2", [i, club]);
  await owner.query("DELETE FROM club WHERE institution_id=$1 AND id=$2", [i, club]);
  await owner.query("DELETE FROM club_proposal WHERE institution_id=$1 AND id=$2", [i, club]);
  await owner.query("DELETE FROM notice WHERE institution_id=$1 AND id IN ($2,$3,$4)", [i, ids.sectionNotice, ids.collegeNotice, ids.draftNotice]);
  await owner.query("DELETE FROM policy_version WHERE institution_id=$1 AND policy_id=$2", [i, ids.staffPolicy]);
  await owner.query("DELETE FROM policy WHERE institution_id=$1 AND id=$2", [i, ids.staffPolicy]);
  await owner.query("DELETE FROM opportunity_listing WHERE institution_id=$1 AND id=$2", [i, ids.listing]);
  await owner.query("DELETE FROM calendar_entry WHERE institution_id=$1 AND id=$2", [i, ids.date]);
  await Promise.all([db.end(), owner.end()]);
});

test("one search returns only what each reader may open on the kind's own page", async () => {
  assert.deepEqual(await titles("student"), [`Club event: Members build night ${tag}`, `Club event: Open demo day ${tag}`, `College date: Open day ${tag}`,
    `Notice: Exam circular ${tag}`, `Notice: Section A lab ${tag}`, `Opportunity: Hackathon ${tag}`]);
  assert.deepEqual(await titles("outsider"), [`Club event: Open demo day ${tag}`, `College date: Open day ${tag}`, `Notice: Exam circular ${tag}`, `Opportunity: Hackathon ${tag}`],
    "another section's notice and a members-only event stay hidden");
  assert.deepEqual(await titles("faculty"), [`Club event: Open demo day ${tag}`, `College date: Open day ${tag}`, `Notice: Exam circular ${tag}`, `Notice: Section A lab ${tag}`,
    `Policy: Staff rule ${tag} (version 1)`],
    "staff see the staff policy; drafts and opportunities do not appear");
  assert.deepEqual(await titles("tenant"), [], "another college sees nothing");
  assert.deepEqual(await titles("student", `record ${tag}`), [`Notice: Section A lab ${tag}`], "every word must match");
  assert.deepEqual(await search({ ...as.get("student")!, role: "admin" }, tag), [], "a role without membership sees nothing");
  await assert.rejects(() => search(as.get("student")!, "x"), { name: "ZodError" });
});
