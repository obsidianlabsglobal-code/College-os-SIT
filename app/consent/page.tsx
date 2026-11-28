import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { acceptNoticeAction } from "../actions/onboarding";
import { account, scope } from "../../lib/scope";
import { NOTICE } from "../../lib/consent";

export default async function Consent({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  return <Chrome user={user} current={current} section="/settings" skipConsent>
    <section className="panel stack" aria-labelledby="notice-title">
      <h1 id="notice-title">{NOTICE.title}</h1>
      <p className="meta">Please read this before using NEXUS. Version {NOTICE.version}.</p>
      <ul className="items">{NOTICE.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <ActionForm action={acceptNoticeAction} context={current} label="I have read this and agree">
        <input type="hidden" name="version" value={NOTICE.version} />
      </ActionForm>
    </section>
  </Chrome>;
}
