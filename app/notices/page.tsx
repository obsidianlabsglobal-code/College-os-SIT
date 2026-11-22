import { PageHeader } from "../page-header";
import Link from "next/link";
import { account, scope, workspaces, workspaceQuery } from "../../lib/scope";
import { notices, noticeTargets } from "../../lib/connected";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { connected } from "../actions/connected";

export default async function Notices({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string; filter?: string }> }) {
  const [selection,user] = await Promise.all([searchParams,account()]);
  const current = await scope(selection.institution,selection.role);
  const filter = selection.filter === "published" || selection.filter === "draft" ? selection.filter : "all";
  const [records,targets,options] = await Promise.all([notices(current,filter),noticeTargets(current),workspaces(user.id)]);
  const timezone = options.find(option => option.id === current.institution)?.timezone ?? "UTC";
  const query = workspaceQuery(current);
  const canDraft = current.role === "admin" || targets.length > 0;
  return <Chrome user={user} current={current} section="/notices">
    <PageHeader title="Notices" parent={{ href: `/?${query}`, label: "Workspace" }} />
      <nav className="row" aria-label="Filter notices">
        {(["all","published",...(canDraft ? ["draft"] : [])]).map(value => <Link key={value}
          href={`/notices?${query}&filter=${value}`} aria-current={value === filter ? "page" : undefined}>
          {value === "all" ? "All notices" : value === "draft" ? "Drafts" : "Published"}</Link>)}
      </nav>
    <div className={canDraft ? "grid" : "stack"}>
      <section className="panel stack" aria-label="Notice list">
        {!records.length && <p>No notices match this view.</p>}
        {records.map(record => <article className="stack" id={`notice-${record.id}`} key={record.id}>
          <div><h2>{record.title}</h2><p className="meta">{record.author} · {record.audience} · {record.published_at
            ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(record.published_at) : "Draft"}</p></div>
          <p className="prose-text">{record.body}</p>
          {!record.published_at && <ActionForm action={connected} context={current} label="Publish notice" operation="publish-notice" secondary>
            <input type="hidden" name="id" value={record.id} />
          </ActionForm>}
        </article>)}
      </section>
      {canDraft && <section className="panel">
        <h2>Create notice</h2>
        <ActionForm action={connected} context={current} label="Save notice draft" operation="draft-notice">
          {current.role === "admin" ? <p className="meta">Audience · Entire institution</p> : <label>Audience<select name="target" required>
            {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
          </select></label>}
          <label>Title<input name="title" required maxLength={160} /></label>
          <label>Notice<textarea name="body" required maxLength={8000} /></label>
        </ActionForm>
      </section>}
    </div>
  </Chrome>;
}
