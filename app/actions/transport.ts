"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { scope } from "../../lib/scope";
import { changeTransportCatalog } from "../../lib/transport/catalog";
import { changeMaintenance } from "../../lib/transport/maintenance";
import { driverOfficeAction } from "../../lib/transport/driver-office";
import { configureDriverPhone } from "../../lib/transport/driver-phone";
import { linkReplacement,respondToAccident } from "../../lib/transport/incident-responses";
import { changeTransportOversight } from "../../lib/transport/oversight";
import { assignRouteTeacher,signalBusSos } from "../../lib/transport/sos";
import { changeBackupConsent } from "../../lib/transport/rider-backup";
import { boardBus,issueBoardCredential,revokeBoardDevice } from "../../lib/transport/boarding";
import { submitEtaFeedback } from "../../lib/transport/feedback";
import { changeDisruption } from "../../lib/transport/disruptions";
import { saveTransportPreferences } from "../../lib/transport/pickup-alerts";
import { changeTransportTrip } from "../../lib/transport/trips";
import { issueTransportDevice, purgeTransportHistory, publishFictionalTransportPosition, revokeTransportDevice } from "../../lib/transport/telemetry";
import type { ActionState } from "./workflow";

function number(x:unknown) {
  return typeof x==="string" && x.trim()!=="" ? Number(x) : NaN;
}

export async function transportAction(_prior:ActionState,form:FormData):Promise<ActionState> {
  const s=await scope(form.get("institution"),form.get("role"));
  const operation=form.get("operation");
  try {
    if(operation==="driver-send-message"||operation==="driver-document-expiry"||operation==="driver-decide-leave"){
      await driverOfficeAction(s,Object.fromEntries(form));revalidatePath("/transport");return {message:"Driver office record saved."};
    }
    if(operation==="bind-driver-phone"||operation==="revoke-driver-phone"||operation==="driver-office-contact"){
      const enrollment=await configureDriverPhone(s,{...Object.fromEntries(form),backup:form.get("backup")||undefined,backupPin:form.get("backupPin")||undefined});
      revalidatePath("/transport");
      return {message:enrollment?`Enter this one-time enrollment code on the assigned phone within 20 minutes: ${enrollment}`:"Driver settings saved."};
    }
    if(operation==="maintenance-report"||operation==="maintenance-clear"){
      await changeMaintenance(s,Object.fromEntries(form));revalidatePath("/transport");return {message:"Maintenance history updated."};
    }
    if(operation==="accident-response"){
      await respondToAccident(s,Object.fromEntries(form));revalidatePath("/transport");
      return {message:"Your check-in was recorded. This is not an emergency-services call."};
    }
    if(operation==="replacement-trip"){
      const [trip,stop]=String(form.get("replacement")??"").split(":");
      await linkReplacement(s,{incident:form.get("incident"),trip,stop});revalidatePath("/transport");
      return {message:"Replacement trip and meeting stop saved. Publish a follow-up to explain the new arrangement."};
    }
    if(operation==="fee-status"||operation==="speed-policy"){
      await changeTransportOversight(s,{...Object.fromEntries(form),limit:number(form.get("limit")),enabled:form.get("enabled")==="on"});
      revalidatePath("/transport");return {message:"Transport office setting saved."};
    }
    if(operation==="assign-route-teacher"){
      await assignRouteTeacher(s,Object.fromEntries(form));
      revalidatePath("/transport");return {message:"Route teacher assigned."};
    }
    if(operation==="bus-sos"){
      const result=await signalBusSos(s,{trip:form.get("trip"),confirmed:true});
      revalidatePath("/transport");return {message:result.updated?"Your existing SOS was refreshed.":"Your SOS was recorded for college transport staff. This is not an emergency-services call."};
    }
    if(operation==="backup-consent"){
      await changeBackupConsent(s,{trip:form.get("trip"),enabled:form.get("enabled")==="true"});
      revalidatePath("/transport");return {message:"Your backup location choice was saved for this trip only."};
    }
    if(operation==="board-bus"){
      await boardBus(s,form.get("boardingCode"));
      revalidatePath("/transport");return {message:"Your boarding was recorded."};
    }
    if(operation==="issue-boarding-device"||operation==="issue-boarding-sticker"){
      const kind=operation==="issue-boarding-device"?"device":"sticker";
      const code=await issueBoardCredential(s,{vehicle:form.get("vehicle"),kind,label:form.get("label")||undefined});
      revalidatePath("/transport");return {message:`Copy the ${kind==="device"?"boarding screen credential":"new sticker code"} now: ${code}`};
    }
    if(operation==="revoke-boarding-device"){
      await revokeBoardDevice(s,form.get("device"));
      revalidatePath("/transport");return {message:"Boarding device revoked."};
    }
    if (operation==="eta-feedback") {
      const value=form.get("accurate");
      await submitEtaFeedback(s,{trip:form.get("trip"),accurate:value==="yes"?true:value==="no"?false:undefined,comment:form.get("comment")||undefined});
      revalidatePath("/transport");return {message:"Your ETA feedback was saved."};
    }
    if (["open-disruption","publish-disruption","report-bus","read-disruption"].includes(String(operation))) {
      const entered=String(form.get("when")??"");
      const when=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(entered)?entered+":00+05:30":undefined;
      const stop=String(form.get("stop")??"");
      await changeDisruption(s,{...Object.fromEntries(form),when,stop:stop||undefined,
        delay:form.get("delay")?number(form.get("delay")):undefined,expected:number(form.get("expected")),
        sequence:number(form.get("sequence")),alternative:form.get("alternative")||undefined});
      revalidatePath("/transport"); return {message:"Transport notice updated."};
    }
    if (operation==="save-transport-prefs") {
      await saveTransportPreferences(s,{phoneAlerts:form.get("phoneAlerts")==="on",locale:form.get("locale")});
      revalidatePath("/transport");return {message:"Transport preferences saved."};
    }
    if (operation==="create-trip" || operation==="start-trip" || operation==="complete-trip" || operation==="cancel-trip") {
      await changeTransportTrip(s,{...Object.fromEntries(form),driver:form.get("driver")||undefined});
      revalidatePath("/transport");
      return {message:"Trip saved."};
    }
    if (operation==="issue-device") {
      const issued=await issueTransportDevice(s,{...Object.fromEntries(form),clientId:form.get("clientId")||undefined});
      revalidatePath("/transport");
      return {message:issued.protocol==="stock"?`Set this one-time ID in the Traccar Device identifier field: ${issued.token}`:
        `Copy this one-time telemetry token now: ${issued.token}`};
    }
    if (operation==="revoke-device") {
      await revokeTransportDevice(s,form.get("device"));
      revalidatePath("/transport");return {message:"Device revoked."};
    }
    if (operation==="purge-history") {
      const deleted=await purgeTransportHistory(s);
      return {message:`Removed ${deleted} expired positions.`};
    }
    if (operation==="simulated-position") {
      const outcome=await publishFictionalTransportPosition(s,{trip:form.get("trip"),fix:{observedAt:new Date().toISOString(),
        lat:number(form.get("lat")),lon:number(form.get("lon")),speedKmh:form.get("speed")?number(form.get("speed")):undefined,accuracy:15}});
      revalidatePath("/transport");
      return {message:`Simulation report: ${outcome}.`};
    }
    const stops=operation==="publish-stops"
      ? String(form.get("stopText")??"").split(/\r?\n/).filter(x=>x.trim()).map(line=>{
          const parts=line.split("|").map(v=>v.trim());
          if (parts.length!==4) throw new WorkflowError("Use stop name | latitude | longitude | minutes from departure.");
          return {label:parts[0],lat:number(parts[1]),lon:number(parts[2]),offset:number(parts[3])};
        }):undefined;
    await changeTransportCatalog(s,{...Object.fromEntries(form),operation,stops,
      expected:number(form.get("expected")),weekday:number(form.get("weekday")),seats:number(form.get("seats")),
      capacity:number(form.get("capacity")),locked:form.get("locked")==="true"});
    revalidatePath("/transport");
    return {message:operation==="student-choice"?"Bus and stop saved for your next trip.":"Transport changes saved."};
  } catch(e) {
    if(e instanceof WorkflowError) return {error:e.message};
    if(e instanceof z.ZodError) return {error:"Check the required fields and enter valid numbers or times."};
    console.error("Transport write failed",{code:(e as {code?:string}).code??"unknown"});
    return {error:"Could not confirm this change. Refresh and check the current record."};
  }
}
