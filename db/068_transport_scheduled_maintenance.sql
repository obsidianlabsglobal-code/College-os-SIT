-- Allows the scheduled worker to run two fixed operations, without granting it
-- access to bus coordinates, driver credentials, or arbitrary transport writes.
CREATE INDEX transport_position_maintenance_age ON transport_position(observed_at);
CREATE INDEX transport_notice_maintenance_due ON transport_disruption_notice(update_by) WHERE update_by IS NOT NULL;

CREATE FUNCTION public.transport_scheduled_maintenance()
RETURNS TABLE (positions_removed bigint, office_messages bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH expired AS (
    SELECT institution_id,id FROM public.transport_position
    WHERE observed_at < statement_timestamp() - interval '168 hours'
    ORDER BY observed_at,institution_id,id
    LIMIT 10000 FOR UPDATE SKIP LOCKED
  ), removed AS (
    DELETE FROM public.transport_position p USING expired e
    WHERE (p.institution_id,p.id)=(e.institution_id,e.id)
    RETURNING p.id
  ), added AS (
    INSERT INTO public.transport_update_warning(institution_id,disruption_id,notice_sequence)
    SELECT n.institution_id,n.disruption_id,n.sequence
    FROM public.transport_disruption_notice n
    WHERE n.update_by <= statement_timestamp()
      AND NOT EXISTS (
        SELECT 1 FROM public.transport_update_warning w
        WHERE (w.institution_id,w.disruption_id,w.notice_sequence)=(n.institution_id,n.disruption_id,n.sequence)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.transport_disruption_notice x
        WHERE (x.institution_id,x.disruption_id,x.sequence)=(n.institution_id,n.disruption_id,n.sequence+1)
          AND x.published_at <= n.update_by
      )
      AND EXISTS (
        SELECT 1 FROM public.membership m
        WHERE m.institution_id=n.institution_id AND m.role='transport' AND m.ended_at IS NULL
      )
    ORDER BY n.update_by,n.institution_id,n.disruption_id,n.sequence
    LIMIT 1000
    ON CONFLICT DO NOTHING RETURNING institution_id,disruption_id,notice_sequence
  ), messages AS (
    INSERT INTO public.push_message(institution_id,account_id,title,body,url)
    SELECT DISTINCT a.institution_id,m.account_id,'Promised bus update overdue',
      'A transport notice missed its promised update time. Open Transport to review the incident.',
      '/transport?institution='||a.institution_id::text||'&role=transport#disruptions'
    FROM added a JOIN public.membership m ON m.institution_id=a.institution_id
      AND m.role='transport' AND m.ended_at IS NULL
    RETURNING id
  )
  SELECT (SELECT count(*) FROM removed),(SELECT count(*) FROM messages);
$$;
REVOKE ALL ON FUNCTION public.transport_scheduled_maintenance() FROM PUBLIC,nexus_app;
GRANT EXECUTE ON FUNCTION public.transport_scheduled_maintenance() TO nexus_worker;
