import Link from "next/link";
import { Brand } from "../../experience/brand";
import { ActionForm } from "../../forms";
import { requestSignInCode, signInWithCode } from "../../actions/session";

export default async function CodeSignIn({ searchParams }: { searchParams: Promise<{ email?: string; next?: string }> }) {
  const params = await searchParams;
  const email = params.email?.slice(0, 254);
  const next = params.next && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next.slice(0, 300) : "";
  return <div className="shell">
    <header className="top"><span className="brand"><Brand /></span><span className="meta">College OS</span></header>
    <main className="login" id="main">
      <div className="hero"><h1>Sign in with an email code</h1><p className="meta">No password needed. We email you a 6-digit code that works once for 10 minutes.</p></div>
      {!email ? <section className="panel">
        <ActionForm action={requestSignInCode} label="Email me a code">
          <input type="hidden" name="next" value={next} />
          <label>Email<input type="email" name="email" autoComplete="email" required maxLength={254} /></label>
        </ActionForm>
      </section> : <section className="panel stack">
        <p>If <strong>{email}</strong> can sign in, a code is on its way. Check your inbox and spam folder.</p>
        <ActionForm action={signInWithCode} label="Sign in">
          <input type="hidden" name="email" value={email} /><input type="hidden" name="next" value={next} />
          <label>6-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
        </ActionForm>
        <p className="meta"><Link href={`/login/code${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Use a different email or send a new code</Link></p>
      </section>}
      <p className="meta"><Link href="/login">Sign in with a password instead</Link> · New student? <Link href="/join/student">Ask to join your section</Link></p>
    </main>
  </div>;
}
