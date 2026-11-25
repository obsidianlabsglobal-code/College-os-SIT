import Link from "next/link";
import { notFound } from "next/navigation";
import { onboardingEntryKind, onboardingPreviewEnabled } from "../../../lib/onboarding-preview";
import { Brand } from "../../experience/brand";

const details = {
  student: { title: "Join NEXUS as a student", description: "Your college must verify that you are eligible and approve your access before you can open a student workspace." },
  faculty: { title: "Join NEXUS as faculty", description: "Your college must verify your appointment and the classes you teach before you can open a faculty workspace." },
  staff: { title: "Join NEXUS as staff", description: "An authorized college administrator must verify your duties and grant the correct access. This page cannot grant staff or leadership access." },
};

export default async function JoinPreview({ params }: { params: Promise<{ kind: string }> }) {
  if (!onboardingPreviewEnabled()) notFound();
  const kind = onboardingEntryKind((await params).kind);
  if (!kind) notFound();
  const detail = details[kind];
  return <div className="shell">
    <header className="top"><span className="brand"><Brand /></span><span className="meta">Onboarding preview</span></header>
    <main className="login" id="main">
      <div className="hero"><h1>{detail.title}</h1><p className="meta">This QR page does not give you access.</p></div>
      <section className="panel stack">
        <h2>What happens next</h2><p>{detail.description}</p>
        <p><strong>Preview only.</strong> Google sign-in and profile submission are not open. Do not enter or send real student or staff details.</p>
        <div><Link className="button secondary" href="/login">Back to demo sign-in</Link></div>
      </section>
    </main>
  </div>;
}
