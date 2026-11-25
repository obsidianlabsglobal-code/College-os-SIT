import { Brand } from "../experience/brand";
import { ActionForm } from "../forms";
import { signIn } from "../actions/session";

export default function LoginPage() {
  return <div className="shell">
    <header className="top"><span className="brand"><Brand /></span><span className="meta">Obsidian Labs</span></header>
    <main className="login" id="main">
      <div className="hero"><h1>Sign in</h1><p className="meta">College OS · Academic workspace</p></div>
      {process.env.NEXUS_FICTIONAL_PILOT === "true" &&
        <p className="panel"><strong>Usability test only.</strong> Use the test account provided by the organizer. Do not enter real grades, attendance, student details, or files.</p>}
      <section className="panel">
        <ActionForm action={signIn} label="Sign in">
          <label>Email<input type="email" name="email" autoComplete="username" required /></label>
          <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
        </ActionForm>
      </section>
    </main>
  </div>;
}
