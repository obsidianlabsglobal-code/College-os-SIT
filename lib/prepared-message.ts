/** Keep user-facing fields on one line; do not allow injected headers or hidden controls. */
export const oneLine = (value:string) => value.replace(/[\s\p{Cc}\p{Cf}]+/gu," ").trim();

export function roomChangeMessage(info:{
  course:string; section:string; date:string; time:string; oldRoom:string; newRoom:string;
}){
  return ["Timetable update: room change",`Class: ${oneLine(info.course)} · ${oneLine(info.section)}`,
    `Date and time: ${oneLine(info.date)} · ${oneLine(info.time)}`, `From: ${oneLine(info.oldRoom)}`,
    `Go to: ${oneLine(info.newRoom)}`, "Class time and faculty are unchanged. Please refer to the current timetable in NEXUS."].join("\n");
}

export function clubEventMessage(info:{
  club:string; title:string; when:string; venue:string; audience:"club"|"institution"; registrationOpen:boolean;
}) {
  return ["CLUBVERSE event announcement", `Event: ${oneLine(info.title)}`, `Organized by: ${oneLine(info.club)}`,
    `When: ${oneLine(info.when)}`,`Location in the event listing: ${oneLine(info.venue)}`,
    `Audience: ${info.audience==="club" ? "Club members only" : "Eligible students"}`,
    info.registrationOpen ? "Registration is open in CLUBVERSE. Check the listing for eligibility and space." :
      "Check CLUBVERSE for registration status and current details."].join("\n");
}

export function requestLetter(input:{
  type:"leave"|"permission"; recipient:string; person:string; affiliation:string; institution:string;
  firstDate:string; lastDate:string; reason:string;
}) {
  const date = (value:string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value+"T00:00:00Z");
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) return null;
    return new Intl.DateTimeFormat("en-IN",{dateStyle:"long",timeZone:"UTC"}).format(parsed);
  };
  const from=date(input.firstDate),to=date(input.lastDate),recipient=oneLine(input.recipient),reason=oneLine(input.reason);
  if (!from||!to||input.firstDate>input.lastDate||!recipient||recipient.length>100||reason.length>250||
    (input.type==="permission"&&!reason)) return null;
  const period=input.firstDate===input.lastDate ? `on ${from}` : `from ${from} to ${to}`;
  const leave=input.type==="leave";
  return [
    `To: ${recipient}`,oneLine(input.institution),"",`Subject: ${leave ? "Request for leave" : "Request for permission"}`,"",
    "Dear Sir/Madam,","",
    leave ? `I request leave ${period}${reason ? ` for ${reason}` : ""}.` : `I request permission ${period} for the following: ${reason}.`,
    "Please let me know if any additional information is required.","","Thank you,",oneLine(input.person),oneLine(input.affiliation),
  ].join("\n");
}
