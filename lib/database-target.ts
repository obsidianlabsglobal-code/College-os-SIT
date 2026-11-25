// Allowlist values are independently configured, password-free PostgreSQL URIs.
// A shared pooler hostname alone does not identify a Supabase project.
export function databaseConnection(purpose:"runtime"|"migration", env:Readonly<Record<string,string|undefined>>=process.env) {
  const connection=purpose==="runtime" ? env.DATABASE_URL : env.MIGRATION_DATABASE_URL;
  const expected=purpose==="runtime" ? env.NEXUS_RUNTIME_TARGET : env.NEXUS_MIGRATION_TARGET;
  const denied=()=>new Error("Database connection does not match the approved NEXUS "+purpose+" target.");
  if (!connection || !URL.canParse(connection)) throw denied();
  const url=new URL(connection);
  if (!["postgres:","postgresql:"].includes(url.protocol) || !url.username || !url.hostname ||
      !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.hash) throw denied();
  // pg accepts routing overrides in the query string. Never allow them, even on a loopback URI.
  if ([...url.searchParams.keys()].some(key=>key!=="sslmode") || url.searchParams.getAll("sslmode").length>1) throw denied();
  const local=["127.0.0.1","localhost","[::1]"].includes(url.hostname);
  if (!local || expected) {
    if (!expected || url.searchParams.get("sslmode")!=="verify-full" ||
        (purpose==="runtime" && !/^nexus_app(?:\.[a-z0-9]+)?$/.test(url.username))) throw denied();
    url.password="";
    url.search="";
    if (url.href!==expected) throw denied();
  }
  return connection;
}
