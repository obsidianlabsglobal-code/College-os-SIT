import type {Scope} from "../scope";
import {transaction} from "../db";
import {holdTransportMember} from "./catalog";
export function sweepTransportPromises(scope:Scope){
  return transaction(async c=>{
    await holdTransportMember(c,scope,"transport");
    const due=await c.query(`WITH added AS (
      INSERT INTO transport_update_warning(institution_id,disruption_id,notice_sequence)
      SELECT n.institution_id,n.disruption_id,n.sequence FROM transport_disruption_notice n
      WHERE n.institution_id=$1 AND n.update_by IS NOT NULL AND n.update_by<=clock_timestamp() AND
      NOT EXISTS(SELECT 1 FROM transport_disruption_notice x WHERE x.institution_id=n.institution_id
        AND x.disruption_id=n.disruption_id AND x.sequence=n.sequence+1 AND x.published_at<=n.update_by)
      ON CONFLICT DO NOTHING RETURNING institution_id,disruption_id,notice_sequence
    )
    INSERT INTO push_message(institution_id,account_id,title,body,url)
    SELECT DISTINCT a.institution_id,m.account_id,'Promised bus update overdue',
      'A transport notice missed its promised update time. Open Transport to review the incident.',
      '/transport?institution='||a.institution_id::text||'&role=transport#disruptions'
    FROM added a JOIN membership m ON m.institution_id=a.institution_id AND m.role='transport' AND m.ended_at IS NULL`,[scope.institution]);
    return Number(due.rowCount??0);
  });
}
