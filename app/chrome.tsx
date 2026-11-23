import type { Icon } from "./experience/workspace-icon";
import type { ComponentProps } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "./actions/session";
import { WorkspaceNavigation } from "./workspace-navigation";
import { chooseWorkspace } from "./actions/workspace";
import { workspaces, workspaceQuery, type Scope } from "../lib/scope";

export const roleLabels = {
  student: "Student",
  faculty: "Faculty",
  hod: "Department head",
  admin: "Institution admin",
  principal: "Principal",
} satisfies Record<Scope["role"], string>;

type Destination = "/" | "/grading" | "/notices" | "/requests" | "/admin" | "/clubverse" | "/aura" | "/timetable";
const labels: Record<Destination, string> = {
  "/": "Overview",
  "/timetable": "Timetable",
  "/grading": "Evaluation queue",
  "/notices": "Notices",
  "/clubverse": "CLUBVERSE",
  "/aura": "AURA",
  "/requests": "Service requests",
  "/admin": "Academic setup and roles",
};

const icons: Record<Destination, ComponentProps<typeof Icon>["name"]> = {
  "/": "home", "/timetable": "calendar", "/grading": "check", "/notices": "notice", "/clubverse": "people",
  "/aura": "spark", "/requests": "service", "/admin": "book",
};

export async function Chrome({ user, current, section = "/", children }: {
  user: { id: string; name: string };
  current: Scope | null;
  section?: Destination;
  children: ReactNode;
}) {
  const options = await workspaces(user.id);
  const selected = options.find(option => option.id === current?.institution && option.role === current.role);
  const query = current ? workspaceQuery(current) : "";
  const home = query ? `/?${query}` : "/";
  const destinations: Destination[] = current?.role === "faculty" ? ["/", "/grading", "/notices"] : ["/", "/notices"];
  if (current && ["student", "faculty", "admin", "hod"].includes(current.role)) destinations.splice(1, 0, "/timetable");
  if (current && ["student", "faculty", "admin"].includes(current.role)) destinations.push("/clubverse");
  if (current?.role === "student" || current?.role === "admin") destinations.push("/requests");
  if (current?.role === "admin") destinations.push("/admin");
  if (current?.role === "student" || current?.role === "faculty") destinations.push("/aura");

  return <div className={current ? "app-shell" : "app-shell app-shell-single"}>
    <header className="app-top">
      <Link href={home} className="brand"><span aria-hidden="true" className="brand-mark">N</span>NEXUS</Link>
      {selected && <span className="institution-label">{selected.name}</span>}
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
