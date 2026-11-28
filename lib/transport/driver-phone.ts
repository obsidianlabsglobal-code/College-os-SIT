import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { Scope } from "../scope";
import { audit, WorkflowError } from "../assignments";
import { db, transaction } from "../db";
import { holdTransportMember } from "./catalog";

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const pin = z.string().regex(/^\d{4}$/);
const key = () => randomBytes(32).toString("base64url");
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const deny = () => new WorkflowError("Driver access is unavailable.");
function derived(value:string,salt:string) {
  const secret = process.env.NEXUS_DRIVER_PIN_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length<24) throw deny();
  return scryptSync(createHmac("sha256",secret).update("nexus-driver-pin:"+value).digest(),salt,32);
}
function hashPin(value:string) {
  const salt = randomBytes(32).toString("hex");
  return salt + ":" + derived(value,salt).toString("hex");
}
function verifies(value:string,stored:string) {
  const [salt,hash] = stored.split(":");
  return timingSafeEqual(derived(value,salt),Buffer.from(hash,"hex"));
}
const setup = z.discriminatedUnion("operation", [
  z.object({operation:z.literal("bind-driver-phone"),vehicle:z.uuid(),driver:z.string().min(1).max(100),primaryPin:pin,
    backup:z.string().min(1).max(100).optional(),backupPin:pin.optional()}).refine(i=>
      i.driver!==i.backup && Boolean(i.backup)===Boolean(i.backupPin) && i.primaryPin!==i.backupPin),
  z.object({operation:z.literal("revoke-driver-phone"),device:z.uuid()}),
  z.object({operation:z.literal("driver-office-contact"),phone:z.string().regex(/^\+?[0-9]{6,15}$/)}),
]);
export function configureDriverPhone(scope:Scope,raw:unknown) {
  const i=setup.parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,scope,"transport");
    const tenant=scope.institution;
    if(i.operation==="revoke-driver-phone"){
      if(!(await c.query(`UPDATE transport_driver_phone SET revoked_at=clock_timestamp(),session_digest=NULL,
        session_driver=NULL,session_until=NULL,enrollment_digest=NULL WHERE institution_id=$1 AND id=$2 AND revoked_at IS NULL`,[tenant,i.device])).rowCount) throw deny();
      await audit(c,scope,i.device,"transport.driver_phone_revoked");return null;
    }
    if(i.operation==="driver-office-contact"){
      await c.query(`INSERT INTO transport_driver_contact(institution_id,phone) VALUES($1,$2)
        ON CONFLICT (institution_id) DO UPDATE SET phone=excluded.phone`,[tenant,i.phone]);
      await audit(c,scope,tenant,"transport.driver_office_contact_set");return null;
    }
    for(const person of [i.driver,i.backup].filter((v):v is string=>Boolean(v)))
      await holdTransportMember(c,{institution:tenant,account:person,role:"driver"},"driver");
    if(!(await c.query("SELECT 1 FROM transport_vehicle WHERE institution_id=$1 AND id=$2 AND active FOR SHARE",[tenant,i.vehicle])).rowCount) throw deny();
    const enrollment=key();
    const {rows:[phone]}=await c.query<{id:string}>(`INSERT INTO transport_driver_phone
      (institution_id,vehicle_id,primary_driver,backup_driver,primary_pin_hash,backup_pin_hash,enrollment_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[tenant,i.vehicle,i.driver,i.backup??null,hashPin(i.primaryPin),i.backupPin?hashPin(i.backupPin):null,digest(enrollment)]);
    await audit(c,scope,phone.id,"transport.driver_phone_bound");
    return enrollment;
  });
}
export async function driverPhoneList(s:Scope){
  if(s.role!=="transport")return [];
  return (await db.query<{id:string;vehicle:string;driver:string;revoked:boolean}>(`SELECT b.id,v.label AS vehicle,u.name AS driver,b.revoked_at IS NOT NULL AS revoked
    FROM transport_driver_phone b JOIN transport_vehicle v ON (v.institution_id,v.id)=(b.institution_id,b.vehicle_id)
    JOIN "user" u ON u.id=b.primary_driver WHERE b.institution_id=$1 AND EXISTS
      (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='transport' AND m.ended_at IS NULL)
    ORDER BY v.label,u.name`,[s.institution,s.account])).rows;
}
export function enrollDriverPhone(raw:unknown) {
  const enrollment=token.parse(raw), phone=key();
  return transaction(async c=>{
    const {rowCount}=await c.query(`UPDATE transport_driver_phone SET phone_digest=$2,enrollment_digest=NULL
      WHERE enrollment_digest=$1 AND phone_digest IS NULL AND revoked_at IS NULL AND enroll_until>clock_timestamp()`,[digest(enrollment),digest(phone)]);
    return rowCount?phone:null;
  });
}
type Binding = {id:string;institution_id:string;vehicle_id:string;primary_driver:string;backup_driver:string|null};
export function unlockDriverPhone(phone:unknown,raw:unknown) {
  const credential=token.parse(phone), code=pin.parse(raw);
  return transaction(async c=>{
    const {rows:[b]}=await c.query<Binding & {primary_pin_hash:string;backup_pin_hash:string|null;locked:boolean;bad_attempts:number;reset:boolean}>(`
      SELECT *,COALESCE(locked_until>clock_timestamp(),false) AS locked,
        COALESCE(locked_until<=clock_timestamp(),false) AS reset
      FROM transport_driver_phone WHERE phone_digest=$1 AND revoked_at IS NULL FOR UPDATE`,[digest(credential)]);
    if(!b||b.locked)return null;
    const primary=verifies(code,b.primary_pin_hash), backup=verifies(code,b.backup_pin_hash??b.primary_pin_hash)&&Boolean(b.backup_pin_hash);
    const driver=primary?b.primary_driver:backup?b.backup_driver:null;
    if(!driver){
      const misses=(b.reset?0:b.bad_attempts)+1;
      await c.query(`UPDATE transport_driver_phone SET bad_attempts=$3,locked_until=
        CASE WHEN $3::integer>=5 THEN clock_timestamp()+interval '15 minutes' END
        WHERE institution_id=$1 AND id=$2`,[b.institution_id,b.id,misses]);
      return null;
    }
    const s:Scope={institution:b.institution_id,account:driver,role:"driver"};
    await holdTransportMember(c,s,"driver");
    const session=key();
    await c.query(`UPDATE transport_driver_phone SET session_digest=$3,session_driver=$4,session_until=clock_timestamp()+interval '12 hours',
      bad_attempts=0,locked_until=NULL WHERE institution_id=$1 AND id=$2`,[b.institution_id,b.id,digest(session),driver]);
    await audit(c,s,b.id,"transport.driver_phone_unlocked");
    return session;
  });
}
export async function resolveDriverPhone(q:Pick<PoolClient,"query">,phone:unknown,session:unknown,lock=false){
  const a=token.safeParse(phone),b=token.safeParse(session);
  if(!a.success||!b.success)return null;
  const {rows:[r]}=await q.query<Binding & {session_driver:string}>(`SELECT id,institution_id,vehicle_id,primary_driver,backup_driver,session_driver
    FROM transport_driver_phone p WHERE p.phone_digest=$1 AND p.session_digest=$2 AND revoked_at IS NULL
      AND session_until>clock_timestamp() AND EXISTS(SELECT 1 FROM membership m WHERE m.institution_id=p.institution_id
      AND m.account_id=p.session_driver AND m.role='driver' AND m.ended_at IS NULL)
    ${lock?"FOR UPDATE OF p":""}`,[digest(a.data),digest(b.data)]);
  return r??null;
}
