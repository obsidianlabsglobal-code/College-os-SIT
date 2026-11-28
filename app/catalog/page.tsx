import Link from "next/link";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { courseCatalog } from "../../lib/catalog";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";

export default async function Catalog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const search = (params.q ?? "").trim();
  const entries = await courseCatalog(current, search);
  const query = workspaceQuery(current);
  const departments = [...Map.groupBy(entries, e => e.department)];
  return <Chrome user={user} current={current} section="/catalog">
    <PageHeader title="Course catalog" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Every offering configured for this institution, with its scheme, term, section and current teacher." />
    <section className="panel stack" aria-labelledby="catalog-title">
      <h2 id="catalog-title">Offerings by department</h2>
      <form method="get" className="row" role="search" aria-label="Search catalog">
        {[...new URLSearchParams(query)].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label>Course or department<input name="q" defaultValue={search} maxLength={80} /></label>
        <button className="button secondary">Search</button>
      </form>
      {departments.length ? departments.map(([department, rows]) => <section key={department} aria-label={department}>
        <h3>{department}</h3>
        <div className="table-scroll" role="region" aria-label={`${department} offerings`} tabIndex={0}><table>
          <thead><tr><th scope="col">Course</th><th scope="col">Scheme and term</th><th scope="col">Section</th><th scope="col">Teacher</th><th scope="col">{current.role === "admin" ? "Catalog" : "You"}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.offering}>
            <th scope="row">{row.mine && (current.role === "student" || current.role === "faculty")
              ? <Link href={`/courses/${row.offering}?${query}`}>{row.course}</Link> : row.course}</th>
            <td>{row.scheme} · {row.term}</td><td>{row.section}</td><td>{row.faculty.join(", ") || "Not assigned"}</td>
            <td>{current.role === "admin" ? <ActionForm action={planningAction} context={current} operation={row.visible ? "catalog-hide" : "catalog-show"}
              label={row.visible ? "Hide" : "Show"} secondary><input type="hidden" name="offering" value={row.offering} /></ActionForm>
              : row.mine ? (current.role === "faculty" ? "Teaching" : "Enrolled") : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </section>) : <p>{search ? `No offerings match “${search}”.` : "No offerings are configured yet."}</p>}
    </section>
  </Chrome>;
}
