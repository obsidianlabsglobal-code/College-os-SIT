import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { sportsAction } from "../actions/sports";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { sportsChoices, sportsOverview, venues } from "../../lib/sports";

const levelLabel: Record<string, string> = { intramural: "Intramural", interdepartmental: "Interdepartmental", intercollege: "Intercollege" };
const stateLabel: Record<string, string> = { requested: "Trial requested", selected: "Selected", declined: "Not selected" };

export default async function Sports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const [{ teams, tournaments, fixtures, standings }, choices, rooms] = await Promise.all([sportsOverview(current), sportsChoices(current), venues(current)]);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const admin = current.role === "admin";
  const coached = teams.filter(t => t.coach_id === current.account);
  const internal = teams.filter(t => !t.external);
  return <Chrome user={user} current={current} section="/sports">
    <PageHeader title="Sports" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }}
      context="Teams, trials, fixtures and standings. Standings count completed results only; who played is verified by the match official." />

    {admin && <section className="panel stack" aria-labelledby="sports-office">
      <h2 id="sports-office">Sports office</h2>
      <details><summary>New tournament</summary>
        <ActionForm action={sportsAction} context={current} operation="tournament" label="Create tournament">
          <label>Tournament name<input name="name" required maxLength={160} /></label>
          <label>Sport<input name="sport" required maxLength={60} /></label>
          <label>Level<select name="level" defaultValue="interdepartmental">{Object.entries(levelLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Starts<input type="date" name="starts_on" required /></label><label>Ends<input type="date" name="ends_on" required /></label>
        </ActionForm></details>
      <details><summary>New team or external opponent</summary>
        <ActionForm action={sportsAction} context={current} operation="team" label="Create team">
          <label>Team name<input name="name" required maxLength={120} /></label>
          <label>Team sport<input name="sport" required maxLength={60} /></label>
          <label>Department (department teams only)<select name="department" defaultValue=""><option value="">Open to all students</option>
            {choices.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label><input type="checkbox" name="external" /> External opponent from another college</label>
        </ActionForm></details>
      {tournaments.length > 0 && <details><summary>Enter a team in a tournament</summary>
        <ActionForm action={sportsAction} context={current} operation="enter" label="Enter team">
          <label>Tournament<select name="tournament" required>{tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Team<select name="team" required>{teams.map(t => <option key={t.id} value={t.id}>{t.name} · {t.sport}</option>)}</select></label>
        </ActionForm></details>}
      {tournaments.length > 0 && <details><summary>Schedule a fixture</summary>
        <ActionForm action={sportsAction} context={current} operation="fixture" label="Schedule fixture">
          <label>Tournament<select name="tournament" required>{tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Home team<select name="home" required>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Away team<select name="away" required>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Venue<select name="venue" required>{choices.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label>Official<select name="official" required>{choices.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Starts<input type="datetime-local" name="start" required /></label>
          <label>Length in minutes<input type="number" name="minutes" min={15} max={480} defaultValue={90} required /></label>
        </ActionForm></details>}
    </section>}

    <section className="panel stack" aria-labelledby="teams-title">
      <h2 id="teams-title">Teams</h2>
      {internal.length ? <ul className="items">{internal.map(t => <li key={t.id}><article aria-label={t.name} className="stack">
        <div className="row spread"><h3>{t.name}</h3><span className="tag">{t.sport}{t.department ? ` · ${t.department}` : ""}</span></div>
        <p className="meta">Coach: {t.coach ?? "not assigned"} · {t.selected} selected · Trials {t.trials_open ? "open" : "closed"}</p>
        {current.role === "student" && (t.my_state ? <p><strong>{stateLabel[t.my_state]}</strong>{t.my_reason ? ` · ${t.my_reason}` : ""}</p>
          : t.trials_open && (t.eligible ? <ActionForm action={sportsAction} context={current} operation="trial" label="Request a trial"><input type="hidden" name="team" value={t.id} /></ActionForm>
            : <p className="meta">You are not eligible: this team takes students currently taking a {t.department} course.</p>))}
        {admin && <ActionForm action={sportsAction} context={current} operation="coach" label="Assign coach" secondary>
          <input type="hidden" name="team" value={t.id} />
          <label>Coach<select name="coach" required defaultValue={t.coach_id ?? ""}><option value="" disabled>Choose</option>
            {choices.teachers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></ActionForm>}
        {t.coach_id === current.account && <>
          <ActionForm action={sportsAction} context={current} operation="trials" label={t.trials_open ? "Close trials" : "Open trials"} secondary>
            <input type="hidden" name="team" value={t.id} /><input type="hidden" name="open" value={String(!t.trials_open)} /></ActionForm>
          {t.requests.filter(r => r.state === "requested").map(r => <details key={r.student_id}><summary>Decide trial: {r.name}</summary>
            <ActionForm action={sportsAction} context={current} operation="decide" label="Record decision">
              <input type="hidden" name="team" value={t.id} /><input type="hidden" name="student" value={r.student_id} />
              <label>Decision<select name="decision" defaultValue="selected"><option value="selected">Select</option><option value="declined">Do not select</option></select></label>
              <label>Reason<input name="reason" required maxLength={500} /></label></ActionForm></details>)}
        </>}
        {t.requests.some(r => r.state === "selected") && <p className="meta">Squad: {t.requests.filter(r => r.state === "selected").map(r => r.name).join(", ")}</p>}
        {t.training.length > 0 && <ul className="items">{t.training.map(x => <li key={x.id} className="meta">Training · {when.format(new Date(x.starts_at))} · {x.venue}</li>)}</ul>}
        {t.announcements.length > 0 && <ul className="items">{t.announcements.map((a, i) => <li key={i}><p>{a.body}</p><p className="meta">{a.author} · {when.format(new Date(a.created_at))}</p></li>)}</ul>}
      </article></li>)}</ul> : <p>No teams yet.</p>}
    </section>

    {coached.length > 0 && <section className="panel stack" aria-labelledby="coach-title">
      <h2 id="coach-title">Coach tools</h2>
      <details><summary>Publish a training session</summary>
        <ActionForm action={sportsAction} context={current} operation="training" label="Publish training">
          <label>Team<select name="team" required>{coached.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Venue<select name="venue" required>{rooms.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label>Starts<input type="datetime-local" name="start" required /></label>
          <label>Length in minutes<input type="number" name="minutes" min={15} max={480} defaultValue={60} required /></label>
        </ActionForm></details>
      <details><summary>Post a team announcement</summary>
        <ActionForm action={sportsAction} context={current} operation="announce" label="Post announcement">
          <label>Team<select name="team" required>{coached.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Announcement<textarea name="body" required maxLength={1000} /></label>
        </ActionForm></details>
    </section>}

    <section className="panel stack" aria-labelledby="fixtures-title">
      <h2 id="fixtures-title">Fixtures and results</h2>
      {fixtures.length ? <ul className="items">{fixtures.map(f => <li key={f.id}><article aria-label={`${f.home} v ${f.away}`} className="stack">
        <div className="row spread"><h3>{f.home} v {f.away}</h3><span className="tag">{f.state === "completed" ? `${f.home_score}–${f.away_score}` : "Scheduled"}</span></div>
        <p className="meta">{f.tournament} · {when.format(f.starts_at)} · {f.venue} · Official {f.official}{f.revision > 1 ? ` · revised: ${f.result_reason}` : ""}</p>
        {f.participants.length > 0 && <p className="meta">Played: {f.participants.map(p => p.name).join(", ")}</p>}
        {f.official_id === current.account && <details><summary>{f.state === "completed" ? "Revise result or verify players" : "Record result"}</summary>
          <ActionForm action={sportsAction} context={current} operation="result" label={f.state === "completed" ? "Revise result" : "Record result"}>
            <input type="hidden" name="fixture" value={f.id} />
            <label>{f.home} score<input type="number" name="home" min={0} required defaultValue={f.home_score ?? undefined} /></label>
            <label>{f.away} score<input type="number" name="away" min={0} required defaultValue={f.away_score ?? undefined} /></label>
            {f.state === "completed" && <label>Reason for revision<input name="reason" required maxLength={500} /></label>}
          </ActionForm>
          {f.state === "completed" && <ActionForm action={sportsAction} context={current} operation="participation" label="Verify players">
            <input type="hidden" name="fixture" value={f.id} />
            <fieldset><legend>Who played</legend>{teams.filter(t => t.id === f.home_team_id || t.id === f.away_team_id).flatMap(t => t.requests.filter(r => r.state === "selected"))
              .map(r => <label key={r.student_id}><input type="checkbox" name="students" value={r.student_id} /> {r.name}</label>)}</fieldset>
          </ActionForm>}
        </details>}
      </article></li>)}</ul> : <p>No fixtures yet.</p>}
    </section>

    <section className="panel stack" aria-labelledby="standings-title">
      <h2 id="standings-title">Tournaments and standings</h2>
      {tournaments.length ? tournaments.map(t => <div key={t.id} className="stack">
        <h3>{t.name}</h3><p className="meta">{t.sport} · {levelLabel[t.level]} · {t.starts_on} to {t.ends_on}</p>
        <table className="standings"><caption className="sr-only">Standings for {t.name}</caption>
          <thead><tr><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col"><abbr title="Points scored">F</abbr></th><th scope="col"><abbr title="Points conceded">A</abbr></th><th scope="col">Pts</th></tr></thead>
          <tbody>{standings.filter(s => s.tournament_id === t.id).map(s => <tr key={s.team}><th scope="row">{s.team}</th><td>{s.played}</td><td>{s.won}</td><td>{s.drawn}</td><td>{s.lost}</td><td>{s.scored}</td><td>{s.conceded}</td><td>{s.points}</td></tr>)}</tbody>
        </table></div>) : <p>No tournaments yet.</p>}
    </section>
  </Chrome>;
}
