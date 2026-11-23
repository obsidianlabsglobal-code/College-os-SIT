import "../scripts/environment";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { changeClass } from "../lib/academic-day";
import { changeClub } from "../lib/clubverse";
import { changeResource } from "../lib/resource-booking";
import { eventBooking, resourceQueue } from "../lib/resource-views";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { demoEmail, fixtures } from "../scripts/fixtures";

const owner = new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const accounts = new Map<string,string>();
const actor = (alias:string,role:Scope["role"],institution=fixtures.institution):Scope =>
  ({account:accounts.get(alias)!,role,institution});
const stamp = (hours:number) => new Intl.DateTimeFormat("sv-SE",{
  dateStyle:"short",timeStyle:"short",timeZone:"Asia/Kolkata",
}).format(new Date(Date.now()+hours*3_600_000)).replace(" ","T");

before(async () => {
  for (const url of [process.env.DATABASE_URL,process.env.MIGRATION_DATABASE_URL]) {
    assert.ok(url && ["localhost","127.0.0.1"].includes(new URL(url).hostname));
  }
  for (const alias of ["faculty","student","admin","tenant","replacement"]) {
    const {rows:[user]} = await owner.query<{id:string}>('SELECT id FROM "user" WHERE email=$1',[demoEmail(alias)]);
    assert.ok(user);
    accounts.set(alias,user.id);
  }
});
after(async () => {await Promise.all([owner.end(),db.end()]);});

test("venue approval serializes collisions, respects grants and atomically releases cancelled events",async () => {
  const organizer = actor("faculty","faculty");
  const reviewer = actor("admin","admin");
  const custodian = actor("replacement","faculty");
  const student = actor("student","student");
  const tenant = actor("tenant","student",fixtures.otherInstitution);
  const club = await changeClub(organizer,{
    operation:"draft",name:`Booking club ${randomUUID()}`,purpose:"Host workshops",category:"technical",rules:"Open learning",
    audience:"campus",joining:"open",
  });
  await changeClub(organizer,{operation:"proposal",id:club,revision:0,next:"submitted"});
  await changeClub(reviewer,{operation:"proposal",id:club,revision:1,next:"under_review"});
  await changeClub(reviewer,{operation:"proposal",id:club,revision:2,next:"approved"});
  const starts = stamp(5), ends = stamp(6);
  const make = (start:string,end:string) => changeClub(organizer,{operation:"event-draft",club,
    title:`Private event ${randomUUID()}`,location:"To be confirmed",requirements:"Test materials",
    audience:"club",starts:start,ends:end,capacity:10,
  });
  const first = await make(starts,ends);
  const second = await make(starts,ends);
  const adjoining = await make(ends,stamp(7));
  const room = (name:string) => changeResource(reviewer,{operation:"create",name:`${name} ${randomUUID()}`,kind:"room",location:"Campus"});
  const resource = await room("Room");
  const alternate = await room("Alternate");
  const grant = await changeResource(reviewer,{operation:"grant",resource,account:custodian.account,days:2});
  await changeResource(reviewer,{operation:"grant",resource:alternate,account:custodian.account,days:2});
  const request = (event:string,resourceId=resource) => changeResource(organizer,{operation:"request",event,resource:resourceId});
  await assert.rejects(changeResource(student,{operation:"request",event:first,resource}),/unavailable/);
  await assert.rejects(changeResource(tenant,{operation:"request",event:first,resource}),/unavailable/);
  assert.equal(await eventBooking(student,first),null);
  assert.equal(await eventBooking(tenant,first),null);
  const a = await request(first), b = await request(second);
  assert.equal(await request(first),a);
  const abutting = await request(adjoining);
  const other = await request(second,alternate);
  const confirm = (booking:string) => ({operation:"confirm",booking,revision:0});
  await assert.rejects(changeResource(reviewer,confirm(a)),/unavailable/);
  const queue = await resourceQueue(custodian,1);
  assert.equal(queue.bookings.length,4);
  assert.doesNotMatch(JSON.stringify(queue.bookings),/Private event|Test materials/);
  const pair = await Promise.allSettled([a,b].map(id=>changeResource(custodian,confirm(id))));
  const accepted = pair.flatMap(value=>value.status==="fulfilled" ? [value.value] : []);
  assert.equal(accepted.length,1);
  const rejected = pair.find(value=>value.status==="rejected");
  assert.match(String(rejected?.reason),/already holds/);
  assert.equal(await changeResource(custodian,confirm(accepted[0])),accepted[0]);
  await changeResource(custodian,confirm(abutting));
  await changeResource(custodian,confirm(other));
  const classDraft = (room:string) => changeClass(reviewer,{
    operation:"draft", offering:fixtures.offering,faculty:organizer.account,room,start:starts,end:ends,weeks:1,
  });
  const collidingClass = await classDraft(alternate);
  await assert.rejects(changeClass(reviewer,{operation:"publish",session:collidingClass,revision:0}),/confirmed booking/);
  const classRoom = await room("Teaching room");
  await changeResource(reviewer,{operation:"grant",resource:classRoom,account:custodian.account,days:2});
  const lesson = await classDraft(classRoom);
  await changeClass(reviewer,{operation:"publish",session:lesson,revision:0});
  assert.equal((await eventBooking(organizer,second))?.resources.find(item=>item.id===classRoom)?.busy,true);
  const classBooking = await request(second,classRoom);
  await assert.rejects(changeResource(custodian,confirm(classBooking)),/scheduled class/);
  await changeClass(reviewer,{operation:"cancel",session:lesson,revision:1,reason:"End the test class reservation"});

  const winner = accepted[0] === a ? first : second;
  await changeClub(organizer,{operation:"event-state",club,id:winner,revision:0,next:"cancelled"});
  const history = await eventBooking(organizer,winner);
  assert.ok(history?.bookings.some(item=>item.id===accepted[0] && item.state==="cancelled"));
  await assert.rejects(request(winner),/upcoming events/);
  const loser = accepted[0] === a ? b : a;
  await owner.query("UPDATE resource_custodian SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=$1",[grant]);
  await assert.rejects(changeResource(custodian,confirm(loser)),/unavailable/);
  const renewed = await changeResource(reviewer,{operation:"grant",resource,account:custodian.account,days:1});
  await owner.query(`CREATE FUNCTION fail_booking_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='booking.confirmed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`);
  await owner.query("CREATE TRIGGER fail_booking_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_booking_audit()");
  try {
    await assert.rejects(changeResource(custodian,confirm(loser)),/test audit failure/);
    const {rows:[record]} = await owner.query("SELECT state,revision FROM resource_booking WHERE id=$1",[loser]);
    assert.deepEqual(record,{state:"requested",revision:0});
  } finally {
    await owner.query("DROP TRIGGER fail_booking_audit ON audit_event");
    await owner.query("DROP FUNCTION fail_booking_audit()");
  }
  await changeResource(reviewer,{operation:"revoke",grant:renewed});
  await assert.rejects(changeResource(custodian,confirm(loser)),/unavailable/);
});
