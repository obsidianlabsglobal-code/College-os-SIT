-- Optional fictional SIT pilot walkthrough records. Not a schema migration.
-- Run as the owner of the dedicated, already seeded fictional NEXUS database.
DO $nexus_walkthrough$
DECLARE
  campus constant uuid := '10000000-0000-4000-8000-000000000001';
  other_campus constant uuid := '10000000-0000-4000-8000-000000000002';
  course_offer constant uuid := '70000000-0000-4000-8000-000000000001';
  section_a constant uuid := '40000000-0000-4000-8000-000000000001';
  lab constant uuid := '95000000-0000-4000-8000-000000000001';
  studio constant uuid := '95000000-0000-4000-8000-000000000002';
  series constant uuid := '95000000-0000-4000-8000-000000000010';
  club_id constant uuid := '95000000-0000-4000-8000-000000000020';
  event_id constant uuid := '95000000-0000-4000-8000-000000000021';
  hands_on constant uuid := '95000000-0000-4000-8000-000000000030';
  checkpoint constant uuid := '95000000-0000-4000-8000-000000000031';
  admin_user text;
  faculty_user text;
  student_user text;
  day0 date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  event_start timestamptz := ((day0+3) + time '14:00') AT TIME ZONE 'Asia/Kolkata';
  r record;
  mark_revision record;
BEGIN
  IF current_database() <> 'nexus' OR current_user NOT IN ('nexus_owner','postgres') THEN
    RAISE EXCEPTION 'Use the dedicated fictional NEXUS database as its approved owner';
  END IF;
  IF NOT pg_try_advisory_xact_lock(607146) THEN RAISE EXCEPTION 'Another NEXUS setup operation is active'; END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE name='014_opportunity_directory.sql')
     OR (SELECT count(*) FROM institution) <> 2
     OR NOT EXISTS (SELECT 1 FROM institution WHERE id=campus AND name='Northfield Institute · Fictional demo')
     OR NOT EXISTS (SELECT 1 FROM institution WHERE id=other_campus AND name='Westhaven College · Fictional demo')
     OR EXISTS (SELECT 1 FROM "user" WHERE email NOT LIKE '%@nexus.example.invalid') THEN
    RAISE EXCEPTION 'Unexpected database contents; walkthrough seed cancelled';
  END IF;

  SELECT id INTO STRICT admin_user FROM "user" WHERE email='admin@nexus.example.invalid';
  SELECT id INTO STRICT faculty_user FROM "user" WHERE email='faculty@nexus.example.invalid';
  SELECT id INTO STRICT student_user FROM "user" WHERE email='student@nexus.example.invalid';
  IF NOT EXISTS (SELECT 1 FROM membership WHERE institution_id=campus AND account_id=admin_user AND role='admin' AND ended_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM roster WHERE institution_id=campus AND offering_id=course_offer AND account_id=faculty_user AND role='faculty' AND ended_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM roster WHERE institution_id=campus AND offering_id=course_offer AND account_id=student_user AND role='student' AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Expected fictional roles and rosters are missing';
  END IF;

  FOR r IN
    INSERT INTO campus_resource (institution_id,id,name,kind,location,capacity) VALUES
      (campus,lab,'Circuits Lab A','room','Northfield demo block · Level 1',32),
      (campus,studio,'Maker Studio','room','Northfield demo block · Level 2',24)
    ON CONFLICT (institution_id,id) DO NOTHING RETURNING id
  LOOP INSERT INTO audit_event (institution_id,actor_id,entity_id,action) VALUES (campus,admin_user,r.id,'walkthrough.resource_seeded'); END LOOP;

  FOR r IN
    INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,revision,created_by,published_at)
    SELECT campus, s.id::uuid, series, course_offer, section_a, faculty_user, lab,
      tstzrange(((day0+s.day_offset) + time '10:30') AT TIME ZONE 'Asia/Kolkata',
                ((day0+s.day_offset) + time '11:20') AT TIME ZONE 'Asia/Kolkata','[)'),
      s.state, CASE WHEN s.state='conducted' THEN 2 ELSE 1 END,admin_user,(day0-8)::timestamp AT TIME ZONE 'Asia/Kolkata'
    FROM (VALUES ('95000000-0000-4000-8000-000000000011',-7,'conducted'),
                 ('95000000-0000-4000-8000-000000000012',-4,'conducted'),
                 ('95000000-0000-4000-8000-000000000013',-2,'conducted'),
                 ('95000000-0000-4000-8000-000000000014',1,'published'),
                 ('95000000-0000-4000-8000-000000000015',4,'published')) AS s(id,day_offset,state)
    ON CONFLICT (institution_id,id) DO NOTHING RETURNING id,state,revision
  LOOP
    INSERT INTO audit_event (institution_id,actor_id,entity_id,action,revision) VALUES
      (campus,admin_user,r.id,'walkthrough.class_seeded',r.revision);
    IF r.state='conducted' THEN
      INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id)
      VALUES (campus,r.id,1,faculty_user) RETURNING revision INTO mark_revision;
      INSERT INTO class_attendance_mark (institution_id,session_id,revision,student_id,status)
      SELECT campus,r.id,mark_revision.revision,account_id,
        CASE WHEN r.id='95000000-0000-4000-8000-000000000012' THEN 'absent' ELSE 'present' END
      FROM roster WHERE institution_id=campus AND offering_id=course_offer AND role='student' AND ended_at IS NULL;
    END IF;
  END LOOP;

  INSERT INTO attendance_planning_target (institution_id,offering_id,revision,percent,source,actor_id)
  SELECT campus,course_offer,1,75,'Fictional walkthrough target, not an SIT policy',faculty_user
  WHERE NOT EXISTS (SELECT 1 FROM attendance_planning_target x WHERE x.institution_id=campus AND x.offering_id=course_offer)
  ON CONFLICT DO NOTHING;

  INSERT INTO notice (institution_id,id,author_id,author_role,offering_id,title,body,published_at) VALUES
    (campus,'95000000-0000-4000-8000-000000000040',faculty_user,'faculty',course_offer,
     'Lab prep: bring a circuit sketch','Fictional course notice: sketch a simple voltage divider before the next lab. Do not upload real classwork.',now())
  ON CONFLICT (institution_id,id) DO NOTHING;

  INSERT INTO notice (institution_id,id,author_id,author_role,title,body,published_at) VALUES
    (campus,'95000000-0000-4000-8000-000000000041',admin_user,'admin',
     'Welcome to the Northfield walkthrough','All names, grades, rooms and events in this walkthrough are fictional.',now())
  ON CONFLICT (institution_id,id) DO NOTHING;

  INSERT INTO club_proposal (institution_id,id,founder_id,category_id,template_id,name,purpose,rules,joining,audience,state,revision,review_note)
  VALUES (campus,club_id,student_user,'technical','technical-society','Circuit Makers Collective',
    'Fictional demo community for breadboard builds and peer learning.','Treat one another respectfully and use only fictional information.',
    'open','campus','approved',3,'Fictional walkthrough fixture')
  ON CONFLICT (institution_id,id) DO NOTHING;
  INSERT INTO club (institution_id,id) VALUES(campus,club_id) ON CONFLICT DO NOTHING;
  INSERT INTO club_member (institution_id,club_id,account_id,state)
  VALUES(campus,club_id,student_user,'active') ON CONFLICT DO NOTHING;
  INSERT INTO club_grant (institution_id,id,club_id,account_id,kind)
  VALUES(campus,'95000000-0000-4000-8000-000000000022',club_id,student_user,'lead') ON CONFLICT DO NOTHING;
  INSERT INTO club_event (institution_id,id,club_id,author_id,title,location,requirements,audience,starts_at,ends_at,capacity,state,revision,published_at)
  VALUES (campus,event_id,club_id,student_user,'Breadboard build night','Maker Studio',
    'Fictional event. Try exploring registration; there is no real event.','eligible',event_start,event_start+interval '90 minutes',20,'registration_open',4,now())
  ON CONFLICT (institution_id,id) DO NOTHING;

  INSERT INTO resource_custodian (institution_id,id,resource_id,account_id,ends_at)
  VALUES (campus,'95000000-0000-4000-8000-000000000023',studio,faculty_user,now()+interval '30 days') ON CONFLICT DO NOTHING;
  INSERT INTO resource_booking (institution_id,id,resource_id,event_id,requested_by,slot,state,revision)
  VALUES (campus,'95000000-0000-4000-8000-000000000024',studio,event_id,student_user,
   tstzrange(event_start,event_start+interval '90 minutes','[)'),'confirmed',1)
  ON CONFLICT (institution_id,id) DO NOTHING;

  INSERT INTO opportunity_listing (institution_id,id,kind,title,sponsor,eligibility,source_url,deadline,verified_by)
  VALUES(campus,'95000000-0000-4000-8000-000000000050','competition','Fictional circuit design challenge','Northfield Demo Lab',
    'Sample listing only. No real competition, application or prize. The source link opens the fictional pilot guide.',
    'https://github.com/obsidianlabsglobal-code/College-os-SIT/blob/2c77988/docs/SIT_USABILITY_PILOT.md',day0+21,admin_user)
  ON CONFLICT (institution_id,id) DO NOTHING;

  INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at) VALUES
   (campus,hands_on,course_offer,'Voltage divider mini-lab','Fictional exercise: explain how you would test a voltage divider. A sample answer is enough.',now()+interval '10 days',20,now()),
   (campus,checkpoint,course_offer,'Circuit sketch checkpoint','Fictional exercise: label the input, two resistors and the output node.',now()+interval '2 days',20,now()-interval '1 day')
  ON CONFLICT (institution_id,id) DO NOTHING;

  INSERT INTO submission (institution_id,id,assignment_id,student_id,body,submitted_at,request_id)
  VALUES(campus,'95000000-0000-4000-8000-000000000032',checkpoint,student_user,
    'Fictional submission: the output node sits between the two series resistors.',now()-interval '2 hours','95000000-0000-4000-8000-000000000033')
  ON CONFLICT (institution_id,id) DO NOTHING;
END
$nexus_walkthrough$;
