import { verifyCertificate, kindLabel } from "../../lib/certificates";

// AD-012: public check of a certificate code. Deliberately minimal: type, institution, holder initials, date and status.
export default async function Verify({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = ((await searchParams).code ?? "").trim().toUpperCase();
  const result = code ? await verifyCertificate(code) : null;
  return <main className="app-main" id="main" style={{ maxWidth: "36rem", margin: "2rem auto", padding: "0 16px" }}>
    <h1>Verify a certificate</h1>
    <form method="get" className="row" aria-label="Verify a certificate">
      <label>Verification code<input name="code" defaultValue={code} maxLength={12} required /></label><button className="button">Check</button>
    </form>
    {code && <section className="panel" aria-label="Verification result">
      {result ? <>
        <h2>{result.state === "issued" ? "Valid certificate" : "This certificate was revoked"}</h2>
        <p>{kindLabel[result.kind]} certificate issued by {result.institution} on {result.issued_on} to {result.holder}</p>
      </> : <h2>No certificate matches this code</h2>}
    </section>}
  </main>;
}
