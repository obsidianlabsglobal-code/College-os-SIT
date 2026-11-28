import { z } from "zod";

export const disruptionKinds = ["puncture", "breakdown", "road_block", "accident_no_injuries",
  "accident_injury", "heavy_traffic", "weather_flooding", "fuel", "driver_delayed", "route_diverted", "trip_cancelled"] as const;
export const riderLocales = ["en", "kn"] as const;

const labels = {
  puncture: ["has a flat tyre", "ಬಸ್ಸಿನ ಟೈರ್ ಪಂಕ್ಚರ್ ಆಗಿದೆ"],
  breakdown: ["has a breakdown", "ಬಸ್ ಕೆಟ್ಟಿದೆ"],
  road_block: ["is held up by a road closure", "ರಸ್ತೆ ಮುಚ್ಚಿರುವುದರಿಂದ ಬಸ್ ಮುಂದೆ ಹೋಗಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ"],
  accident_no_injuries: ["was involved in an accident; no injuries have been reported", "ಬಸ್ ಅಪಘಾತಕ್ಕೀಡಾಗಿದೆ; ಗಾಯಗೊಂಡವರ ಬಗ್ಗೆ ಇದುವರೆಗೆ ವರದಿಯಾಗಿಲ್ಲ"],
  accident_injury: ["was involved in an accident and someone is hurt", "ಬಸ್ ಅಪಘಾತಕ್ಕೀಡಾಗಿದೆ ಮತ್ತು ಒಬ್ಬರಿಗೆ ಅಥವಾ ಹೆಚ್ಚು ಜನರಿಗೆ ಗಾಯವಾಗಿದೆ"],
  heavy_traffic: ["is delayed by heavy traffic", "ದಟ್ಟ ಸಂಚಾರದಿಂದ ಬಸ್ ತಡವಾಗಿದೆ"],
  weather_flooding: ["is delayed by unsafe weather or flooding", "ಕೆಟ್ಟ ಹವಾಮಾನ ಅಥವಾ ಪ್ರವಾಹದಿಂದ ಬಸ್ ತಡವಾಗಿದೆ"],
  fuel: ["has stopped due to a fuel issue", "ಇಂಧನದ ಸಮಸ್ಯೆಯಿಂದ ಬಸ್ ನಿಂತಿದೆ"],
  driver_delayed: ["is starting later than planned", "ಬಸ್ ನಿಗದಿತ ಸಮಯಕ್ಕಿಂತ ತಡವಾಗಿ ಹೊರಡಲಿದೆ"],
  route_diverted: ["is taking a different route", "ಬಸ್ ಬೇರೆ ಮಾರ್ಗದಲ್ಲಿ ಸಾಗುತ್ತಿದೆ"],
  trip_cancelled: ["will not run this trip", "ಬಸ್ಸಿನ ಈ ಟ್ರಿಪ್ ರದ್ದಾಗಿದೆ"],
} satisfies Record<typeof disruptionKinds[number], [string,string]>;

// Only route/vehicle display labels resolved on the server belong here. Keep phone numbers,
// private people and coordinates out of the template data. React must render these as text.
const label = z.string().trim().min(1).max(100).regex(/^[\p{L}\p{M}\p{N} .’'()/&-]+$/u)
  .refine(s => !/^[+-]?\d+(?:\.\d+)?\s*[,/]\s*[+-]?\d+/.test(s), {message:"Use the name of an approved stop, not coordinates."});
const when = z.iso.datetime({offset:true}).refine(s => Number.isFinite(Date.parse(s)));
const action = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("wait_at_stop")}),
  z.object({kind:z.literal("walk_to_stop"), stop:label, safePathConfirmed:z.literal(true)}),
  z.object({kind:z.literal("take_route"), route:label}),
  z.object({kind:z.literal("replacement"), stop:label}),
  z.object({kind:z.literal("await_staff"), stop:label.optional()}),
  z.object({kind:z.literal("resume"), stop:label.optional()}),
]);
const clock = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("eta"), expectedAt:when, delayMinutes:z.number().int().min(0).max(240).optional(), updateBy:when.optional()}),
  z.object({kind:z.literal("update"), updateBy:when}),
  z.object({kind:z.literal("actual"), arrivedAt:when}),
]);
const draft = z.object({
  kind:z.enum(disruptionKinds), locale:z.enum(riderLocales), audience:z.enum(["waiting","aboard"]),
  stage:z.enum(["initial","update","all_clear"]), vehicle:label, nearestStop:label,
  now:when, clock, action, stranded:z.boolean().default(false),
}).superRefine((v, ctx)=>{
  const issue = (message:string) => ctx.addIssue({code:"custom",message,path:["clock"]});
  if ((v.stage==="all_clear") !== (v.clock.kind==="actual")) issue("An all-clear requires a recorded arrival, and only it can use that timestamp.");
  if (v.stage==="all_clear" && v.action.kind!=="resume") issue("Confirm the resumption instruction before closing this notice.");
  if (v.stage!=="all_clear" && v.action.kind==="resume") issue("Do not instruct riders to resume before the incident is resolved.");
  if (v.audience==="aboard" && ["wait_at_stop","walk_to_stop"].includes(v.action.kind)) issue("Choose a confirmed instruction for riders already on board.");
  if (["weather_flooding","road_block","accident_injury","accident_no_injuries"].includes(v.kind) && v.action.kind==="walk_to_stop") issue("These incident types require a safer alternative to a walk instruction.");
  if (v.kind==="trip_cancelled" && v.stage!=="all_clear" && (v.clock.kind!=="update" || !["take_route","replacement","await_staff"].includes(v.action.kind))) issue("A cancelled trip needs alternative instructions, not an ETA for the cancelled bus.");
  const n=Date.parse(v.now);
  if (v.clock.kind==="actual" && Date.parse(v.clock.arrivedAt)>n) issue("Record the actual arrival, not a future timestamp.");
  if (v.clock.kind==="eta" && Date.parse(v.clock.expectedAt)<=n) issue("Use an ETA in the future or promise an update instead.");
  if ("updateBy" in v.clock && v.clock.updateBy && Date.parse(v.clock.updateBy)<=n) issue("Promise a future update.");
});
export type NoticeDraft = z.input<typeof draft>;

const ist = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const time = (value:string) => ist.format(new Date(value));

export function renderDisruption(raw:unknown) {
  const v=draft.parse(raw);
  const en=v.locale==="en";
  const [enKind,knKind]=labels[v.kind];
  const where = en ? `Near ${v.nearestStop}, ${v.vehicle} ${enKind}.` : `${v.nearestStop} ಸಮೀಪ ${v.vehicle}: ${knKind}.`;
  const impact = en
    ? (v.audience==="waiting" ? "This may change your pickup." : "This may delay the rest of your ride.")
    : (v.audience==="waiting" ? "ನಿಮ್ಮ ನಿಲ್ದಾಣಕ್ಕೆ ಬಸ್ ಬರುವ ಸಮಯ ಬದಲಾಗಬಹುದು." : "ನಿಮ್ಮ ಮುಂದಿನ ಪ್ರಯಾಣ ತಡವಾಗಬಹುದು.");
  let timing:string;
  if (v.clock.kind==="actual") timing=en ? `Recorded arrival at ${v.nearestStop}: ${time(v.clock.arrivedAt)} IST.`
    : `${v.nearestStop} ತಲುಪಿದ ಸಮಯ: ${time(v.clock.arrivedAt)} IST.`;
  else if(v.clock.kind==="update") timing=en ? `We'll update you by ${time(v.clock.updateBy)} IST.` : `${time(v.clock.updateBy)} IST ಒಳಗೆ ಮತ್ತೆ ಮಾಹಿತಿ ನೀಡುತ್ತೇವೆ.`;
  else {
    const delay = v.clock.delayMinutes ? (en ? ` (about ${v.clock.delayMinutes} minutes late)` : ` (ಸುಮಾರು ${v.clock.delayMinutes} ನಿಮಿಷ ತಡ)`) : "";
    timing = en ? `Expected ${v.audience==="waiting" ? "pickup" : "arrival"}: ${time(v.clock.expectedAt)} IST${delay}.` : `ನಿರೀಕ್ಷಿತ ಸಮಯ: ${time(v.clock.expectedAt)} IST${delay}.`;
    if(v.clock.updateBy) timing += en ? ` We'll update you by ${time(v.clock.updateBy)} IST.` : ` ${time(v.clock.updateBy)} IST ಒಳಗೆ ಮತ್ತೆ ಮಾಹಿತಿ ನೀಡುತ್ತೇವೆ.`;
  }

  let next:string;
  switch(v.action.kind) {
    case "wait_at_stop": next=en ? "Please wait at your stop." : "ದಯವಿಟ್ಟು ನಿಮ್ಮ ನಿಲ್ದಾಣದಲ್ಲೇ ಕಾಯಿರಿ."; break;
    case "walk_to_stop": next=en ? `Please use the confirmed safe path to ${v.action.stop} for pickup.` : `ದಯವಿಟ್ಟು ಸುರಕ್ಷಿತವೆಂದು ಖಚಿತಪಡಿಸಿದ ದಾರಿಯಲ್ಲಿ ${v.action.stop} ನಿಲ್ದಾಣಕ್ಕೆ ಹೋಗಿ.`; break;
    case "take_route": next=en ? (v.audience==="aboard" ? `When staff confirm it is safe to change buses, take route ${v.action.route}.` : `Please take route ${v.action.route}.`)
        : (v.audience==="aboard" ? `ಬಸ್ ಬದಲಾಯಿಸುವುದು ಸುರಕ್ಷಿತವೆಂದು ಸಿಬ್ಬಂದಿ ಖಚಿತಪಡಿಸಿದ ನಂತರ ${v.action.route} ಮಾರ್ಗದ ಬಸ್ ತೆಗೆದುಕೊಳ್ಳಿ.` : `ದಯವಿಟ್ಟು ${v.action.route} ಮಾರ್ಗದ ಬಸ್ ತೆಗೆದುಕೊಳ್ಳಿ.`); break;
    case "replacement": next=en ? (v.audience==="aboard" ? `A replacement will meet you at ${v.action.stop}. Follow staff directions before moving.` : `Please wait at ${v.action.stop} for the replacement bus.`)
        : (v.audience==="aboard" ? `ಬದಲಿ ಬಸ್ ${v.action.stop} ನಿಲ್ದಾಣದಲ್ಲಿ ನಿಮ್ಮನ್ನು ಕರೆದೊಯ್ಯಲಿದೆ. ಚಲಿಸುವ ಮೊದಲು ಸಿಬ್ಬಂದಿಯ ಸೂಚನೆಗಳನ್ನು ಪಾಲಿಸಿ.` : `ದಯವಿಟ್ಟು ಬದಲಿ ಬಸ್ಸಿಗಾಗಿ ${v.action.stop} ನಿಲ್ದಾಣದಲ್ಲಿ ಕಾಯಿರಿ.`); break;
    case "await_staff": next=en ? (v.action.stop ? `Please wait at ${v.action.stop} and follow staff directions.` : "Please follow transport staff directions.")
        : (v.action.stop ? `ದಯವಿಟ್ಟು ${v.action.stop} ನಿಲ್ದಾಣದಲ್ಲಿ ಕಾಯಿರಿ ಮತ್ತು ಸಿಬ್ಬಂದಿಯ ಸೂಚನೆಗಳನ್ನು ಪಾಲಿಸಿ.` : "ದಯವಿಟ್ಟು ಸಾರಿಗೆ ಸಿಬ್ಬಂದಿಯ ಸೂಚನೆಗಳನ್ನು ಪಾಲಿಸಿ."); break;
    case "resume": next=en ? (v.action.stop ? `Please continue from ${v.action.stop} as directed by transport staff.` : "Please follow transport staff directions to continue your trip.")
        : (v.action.stop ? `ಸಾರಿಗೆ ಸಿಬ್ಬಂದಿಯ ಸೂಚನೆಯಂತೆ ${v.action.stop} ನಿಲ್ದಾಣದಿಂದ ಪ್ರಯಾಣ ಮುಂದುವರಿಸಿ.` : "ಪ್ರಯಾಣ ಮುಂದುವರಿಸಲು ದಯವಿಟ್ಟು ಸಾರಿಗೆ ಸಿಬ್ಬಂದಿಯ ಸೂಚನೆಗಳನ್ನು ಪಾಲಿಸಿ."); break;
  }
  const cleared=en ? `The disruption on ${v.vehicle} near ${v.nearestStop} is resolved. Sorry for the delay.` : `${v.nearestStop} ಬಳಿ ${v.vehicle}ಗೆ ಉಂಟಾಗಿದ್ದ ತೊಂದರೆ ನಿವಾರಣೆಯಾಗಿದೆ. ತಡವಾಗಿದ್ದಕ್ಕೆ ಕ್ಷಮಿಸಿ.`;
  const body = v.stage==="all_clear" ? [cleared,timing,next] : [en ? "Sorry for the disruption." : "ಅಡಚಣೆಗೆ ಕ್ಷಮಿಸಿ.",where,impact,timing,next];
  return {body:body.join(" "), locale:v.locale, audience:v.audience,
    accidentCheckIn:v.stranded && v.stage!=="all_clear" && (v.kind==="accident_injury" || v.kind==="accident_no_injuries")};
}
