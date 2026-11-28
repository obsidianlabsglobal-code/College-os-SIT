import { PreparedMessage } from "../experience/prepared-message";

export function AttendanceGroupCopy({draft,fictionalPractice}:{draft:string;fictionalPractice:boolean}) {
  return <PreparedMessage title="Official WhatsApp group draft" messageLabel="WhatsApp message" buttonLabel="Copy WhatsApp update"
    description={fictionalPractice ? "Fictional named-absence preview. Do not post this example." :
      "Uses the last saved record. Includes totals only. Check the authorized group before pasting."} message={draft} />;
}
