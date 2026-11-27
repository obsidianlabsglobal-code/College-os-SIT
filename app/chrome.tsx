import { cookies } from "next/headers";
import { Brand } from "./experience/brand";
import { ThemePicker } from "./experience/theme";
import { themePreference } from "./experience/theme-preference";
import type { Icon } from "./experience/workspace-icon";
import type { ComponentProps } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "./actions/session";
import { WorkspaceNavigation } from "./workspace-navigation";
import { chooseWorkspace } from "./actions/workspace";
import { workspaces, workspaceQuery, type Scope } from "../lib/scope";
import { feesPreviewAvailable } from "../lib/fees-preview";

export const roleLabels = {
  student: "Student",
  faculty: "Faculty",
  hod: "Department head",
  admin: "Institution admin",
  principal: "Principal",
} satisfies Record<Scope["role"], string>;

type Destination = "/meetings" | "/decisions" | "/certificates" | "/groups" | "/profile" | "/work" | "/growth" | "/policies" | "/questions" | "/exams" | "/improvement" | "/cases" | "/mentoring" | "/calendar" | "/catalog" | "/history" | "/audit" | "/automation" | "/fees" | "/letters" | "/opportunities" | "/" | "/grading" | "/notices" | "/requests" | "/admin" | "/clubverse" | "/aura" | "/timetable";
const labels: Record<Destination, string> = {
  "/fees": "Fees & dues",
  "/opportunities": "Opportunities",
  "/": "Today",
  "/timetable": "Timetable",
  "/letters": "Letter drafts",
  "/grading": "Evaluation queue",
  "/notices": "Notices",
  "/clubverse": "CLUBVERSE",
  "/aura": "AURA",
  "/requests": "Service requests",
  "/automation": "Automation",
  "/audit": "Audit log",
  "/history": "Assessment history",
  "/calendar": "Calendar",
  "/mentoring": "Mentoring",
  "/cases": "Cases",
  "/exams": "Examinations",
  "/policies": "Policies",
  "/growth": "Development and research",
  "/work": "My work",
  "/certificates": "Certificates",
  "/meetings": "Meetings",
  "/decisions": "Decision simulation",
  "/groups": "Study groups",
  "/profile": "My profile",
  "/questions": "Question bank",
  "/improvement": "Improvement actions",
  "/catalog": "Course catalog",
  "/admin": "Academic setup and roles",
};

const icons: Record<Destination, ComponentProps<typeof Icon>["name"]> = {
  "/fees": "service",
  "/opportunities": "service",
  "/": "home", "/timetable": "calendar", "/grading": "check", "/notices": "notice", "/clubverse": "people",
  "/aura": "spark", "/automation": "spark", "/audit": "book", "/history": "check", "/calendar": "calendar", "/mentoring": "people", "/cases": "service", "/exams": "calendar", "/policies": "book", "/growth": "spark", "/work": "check", "/certificates": "book", "/meetings": "people", "/decisions": "spark", "/groups": "people", "/profile": "people", "/questions": "book", "/improvement": "check", "/catalog": "book", "/requests": "service", "/admin": "book", "/letters": "notice",
};

const dock: Destination[] = ["/", "/timetable", "/aura", "/clubverse", "/notices", "/requests", "/opportunities"];

export async function Chrome({ user, current, section = "/", children }: {
  user: { id: string; name: string; email?: string };
  current: Scope | null;
  section?: Destination;
  children: ReactNode;
}) {
  const [options, preferences] = await Promise.all([workspaces(user.id), cookies()]);
  const selected = options.find(option => option.id === current?.institution && option.role === current.role);
  const query = current ? workspaceQuery(current) : "";
  const home = query ? `/?${query}` : "/";
  const destinations: Destination[] = current?.role === "faculty" ? ["/", "/grading", "/notices"] : ["/", "/notices"];
  if (current && ["student", "faculty", "admin", "hod"].includes(current.role)) destinations.splice(1, 0, "/timetable");
  if (current && ["student", "faculty", "admin"].includes(current.role)) destinations.push("/clubverse");
  if (current?.role === "student" || current?.role === "admin") destinations.push("/requests");
  if (current?.role === "student" || current?.role === "admin") destinations.push("/opportunities");
  if (current?.role === "admin") destinations.push("/admin");
  if (current?.role === "admin" || current?.role === "principal") destinations.push("/automation");
  if (current?.role === "admin") destinations.push("/audit");
  if (current?.role === "student") destinations.push("/history");
  if (current?.role === "student" || current?.role === "faculty") destinations.push("/calendar");
  if (current) destinations.push("/catalog");
  if (current && ["student", "faculty", "admin"].includes(current.role)) destinations.push("/mentoring");
  if (current) destinations.push("/cases", "/exams");
  if (current && current.role !== "student") destinations.push("/improvement");
  if (current?.role === "faculty") destinations.push("/questions");
  if (current && ["faculty", "hod", "principal"].includes(current.role)) destinations.push("/growth");
  if (current) destinations.push("/policies");
  if (current?.role === "student" || current?.role === "faculty") destinations.push("/aura");
  // Design Bible student dock: Today, Timetable (learn), AURA, Campus first; the rest sit under More.
  const rank = (d: Destination) => dock.includes(d) ? dock.indexOf(d) : dock.length;  // unlisted pages follow, in insertion order
  if (current?.role === "student") destinations.sort((a, b) => rank(a) - rank(b));

  if (current && current.role !== "student") destinations.splice(1, 0, "/work");
  if (current?.role === "student") destinations.push("/groups", "/profile");
  if (current && current.role !== "student") destinations.push("/meetings");
  if (current?.role === "principal") destinations.push("/decisions");
  if (current?.role === "student" || current?.role === "admin") destinations.push("/certificates");
  if (current && feesPreviewAvailable(current,user)) destinations.push("/fees");

  if (current) destinations.push("/letters");

  return <div className={current ? "app-shell" : "app-shell app-shell-single"}>
    <header className="app-top">
      <Link href={home} className="brand"><Brand /></Link>
      {selected && <span className="institution-label"><span className="workspace-crumb">Campus workspace / {labels[section]}</span>
        {selected.name} <span className="institution-role">· {roleLabels[selected.role]}</span></span>}
      <div className="account-tools">
        {options.length > 1 && <form action={chooseWorkspace} className="workspace-form">
          <label><span className="sr-only">Workspace</span>
            <select name="workspace" defaultValue={query} key={query}>
              {options.map(option => {
                const value = new URLSearchParams({ institution: option.id, role: option.role }).toString();
                return <option key={value} value={value}>{option.name} · {roleLabels[option.role]}</option>;
              })}
            </select>
          </label>
          <button className="button secondary">Switch</button>
        </form>}
        <ThemePicker initial={themePreference(preferences.get("nexus_theme")?.value)} />
        <span className="account-name">{user.name}</span>
        <form action={signOut}><button className="button secondary">Sign out</button></form>
      </div>
    </header>
    {current && <WorkspaceNavigation role={roleLabels[current.role]} items={destinations.map(destination => ({
      href: `${destination}?${query}`,
      label: labels[destination],
      icon: icons[destination],
      active: destination === section,
    }))} />}
    <main className="app-main" id="main" tabIndex={-1}>{children}</main>
  </div>;
}
