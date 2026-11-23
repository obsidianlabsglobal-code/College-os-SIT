import { clubAccess, lockClubActor } from "./clubverse";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

type Booking = {id:string; event_id:string; resource_id:string; name:string; state:string; reason:string|null;
  revision:number; starts:Date; ends:Date; own:boolean};
type Resource = {id:string;name:string;location:string;kind:string;capacity:number|null;busy:boolean};
const bookingColumns = `b.id,b.event_id,b.resource_id,r.name,b.state,b.reason,b.revision,
 lower(b.slot) AS starts,upper(b.slot) AS ends,b.requested_by=$2 AS own`;

export async function eventBooking(scope:Scope,id:string) {
  return transaction(async client => {
    await lockClubActor(client,scope);
    const {rows:[event]} = await client.query<{club_id:string;title:string;state:string;starts_at:Date;ends_at:Date;timezone:string;future:boolean}>(
      `SELECT e.club_id,e.title,e.state,e.starts_at,e.ends_at,i.timezone,e.starts_at>clock_timestamp() AS future
       FROM club_event e JOIN institution i ON i.id=e.institution_id WHERE (e.institution_id,e.id)=($1,$2)`,
      [scope.institution,id],
    );
    if (!event) return null;
    const club = await clubAccess(client,scope,event.club_id);
    if (!club.officer) return null;
    const canRequest = club.state === "active" && event.future && !["cancelled","completed","in_progress"].includes(event.state);
    const catalog = canRequest ? await client.query<Resource>(
      `SELECT r.*,(EXISTS (SELECT 1 FROM resource_booking b WHERE (b.institution_id,b.resource_id)=(r.institution_id,r.id)
         AND b.state='confirmed' AND b.slot && tstzrange($2,$3,'[)'))
         OR EXISTS (SELECT 1 FROM class_session s WHERE (s.institution_id,s.room_id)=(r.institution_id,r.id)
           AND s.state IN ('published','conducted') AND s.slot && tstzrange($2,$3,'[)'))) AS busy
       FROM campus_resource r WHERE institution_id=$1 ORDER BY name,id LIMIT 100`,
      [scope.institution,event.starts_at,event.ends_at],
    ) : {rows:[]};
    const history = await client.query<Booking>(
      `SELECT ${bookingColumns} FROM resource_booking b JOIN campus_resource r
       ON (r.institution_id,r.id)=(b.institution_id,b.resource_id)
       WHERE b.institution_id=$1 AND b.event_id=$3 ORDER BY b.changed_at DESC,b.id LIMIT 100`,
      [scope.institution,scope.account,id],
    );
    return {...event,canRequest,canCancel:club.state==="active", resources:catalog.rows, bookings:history.rows};
  });
}

export async function resourceQueue(scope:Scope, page:number) {
  const params = [scope.institution,scope.account];
  const {rows:bookings} = await db.query<Booking>(
    `SELECT ${bookingColumns} FROM resource_booking b JOIN campus_resource r
     ON (r.institution_id,r.id)=(b.institution_id,b.resource_id)
     WHERE b.institution_id=$1 AND EXISTS (SELECT 1 FROM membership m
       WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$4 AND m.ended_at IS NULL)
     AND EXISTS (SELECT 1 FROM resource_custodian g
       WHERE (g.institution_id,g.resource_id,g.account_id)=(b.institution_id,b.resource_id,$2)
       AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND g.ends_at>clock_timestamp())
     ORDER BY (b.state='requested') DESC,b.changed_at DESC,b.id LIMIT 26 OFFSET $3`,[...params,(page-1)*25,scope.role],
  );
  const {rows:[institution]} = await db.query<{timezone:string}>("SELECT timezone FROM institution WHERE id=$1",[scope.institution]);
  if (scope.role !== "admin") return {bookings,timezone:institution.timezone,admin:null};
  const [resources,people,grants] = await Promise.all([
    db.query<Resource>("SELECT * FROM campus_resource WHERE institution_id=$1 ORDER BY name,id LIMIT 100",[scope.institution]),
    db.query<{id:string;name:string}>(`SELECT u.id,u.name FROM "user" u WHERE EXISTS
      (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=u.id
       AND m.role IN ('student','faculty','admin') AND m.ended_at IS NULL) ORDER BY u.name,u.id LIMIT 200`,[scope.institution]),
    db.query<{id:string;person:string;name:string;ends_at:Date}>(`SELECT g.id,u.name AS person,r.name,g.ends_at
      FROM resource_custodian g JOIN campus_resource r ON (r.institution_id,r.id)=(g.institution_id,g.resource_id)
      JOIN "user" u ON u.id=g.account_id WHERE g.institution_id=$1 AND g.revoked_at IS NULL
      AND g.ends_at>clock_timestamp() ORDER BY g.ends_at,g.id LIMIT 100`,[scope.institution]),
  ]);
  return {bookings,timezone:institution.timezone,admin:{resources:resources.rows,people:people.rows,grants:grants.rows}};
}
