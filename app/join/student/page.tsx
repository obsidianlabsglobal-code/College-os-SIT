import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { Brand } from "../../experience/brand";
import { ActionForm } from "../../forms";
import { requestJoinAction } from "../../actions/onboarding";
import { institutionName, joinOptions, myJoinRequests } from "../../../lib/student-admission";

const stateText: Record<string, string> = { pending: "Waiting for your class mentor or a teacher of your section", approved: "Approved", rejected: "Not approved" };

export default async function JoinStudent({ searchParams }: { searchParams: Promise<{ institution?: string }> }) {
  const params = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  const back = `/join/student${params.institution ? `?institution=${encodeURIComponent(params.institution)}` : ""}`;
  if (!session) redirect(`/login/code?next=${encodeURIComponent(back)}`);
  const [college, options, requests] = await Promise.all([institutionName(params.institution ?? ""), joinOptions(params.institution ?? ""), myJoinRequests(session.user)]);
  const open = requests.some(r => r.state === "pending");
  return <div className="shell">
    <header className="top"><span className="brand"><Brand /></span><span className="meta">Signed in as {session.user.email}</span></header>
    <main className="login" id="main">
      <div className="hero"><h1>Join as a student</h1><p className="meta">{college ? college : "Open the join link your college shared to choose your section."}</p></div>
      {requests.length > 0 && <section className="panel stack" aria-labelledby="my-requests">
        <h2 id="my-requests">Your requests</h2>
        <ul className="items">{requests.map(r => <li key={r.id}><strong>{r.institution} · {r.section}</strong> · {stateText[r.state]}{r.reason ? ` · ${r.reason}` : ""}</li>)}</ul>
        {requests.some(r => r.state === "approved") && <p><Link href="/" className="button">Open NEXUS</Link></p>}
      </section>}
      {college && !open && !requests.some(r => r.state === "approved") && (options.length ? <section className="panel stack" aria-labelledby="join-form">
        <h2 id="join-form">Your details</h2>
        <p className="meta">You will see nothing of the college until a teacher of your section approves you. Share only what is asked.</p>
        <ActionForm action={requestJoinAction} label="Send request">
          <input type="hidden" name="institution" value={params.institution} />
          <label>Full name<input name="name" required minLength={2} maxLength={120} defaultValue={session.user.name !== session.user.email ? session.user.name : ""} /></label>
          <label>USN<input name="usn" required pattern="[A-Za-z0-9]{6,16}" maxLength={16} autoCapitalize="characters" /></label>
          <label>Semester<input type="number" name="semester" required min={1} max={10} /></label>
          <label>Section<select name="section" required defaultValue=""><option value="" disabled>Choose your section</option>
            {options.map(o => <option key={o.section_id} value={o.section_id}>{o.label}</option>)}</select></label>
          <label>Phone (optional)<input type="tel" name="phone" pattern="\+?[0-9 ]{7,16}" maxLength={16} /></label>
          <label>Bus stop (optional)<input name="bus_stop" maxLength={80} /></label>
        </ActionForm>
      </section> : <p className="panel">No sections are open for sign-up at this college yet.</p>)}
    </main>
  </div>;
}
