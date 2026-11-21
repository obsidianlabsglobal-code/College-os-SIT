export const fixtures = {
  institution: "10000000-0000-4000-8000-000000000001",
  otherInstitution: "10000000-0000-4000-8000-000000000002",
  department: "20000000-0000-4000-8000-000000000001",
  otherDepartment: "20000000-0000-4000-8000-000000000002",
  course: "30000000-0000-4000-8000-000000000001",
  section: "40000000-0000-4000-8000-000000000001",
  otherSection: "40000000-0000-4000-8000-000000000002",
  scheme: "50000000-0000-4000-8000-000000000001",
  term: "60000000-0000-4000-8000-000000000001",
  offering: "70000000-0000-4000-8000-000000000001",
  otherOffering: "70000000-0000-4000-8000-000000000002",
  otherDepartmentOffering: "70000000-0000-4000-8000-000000000003",
};

export const personas = {
  faculty: ["Riya Rao", "faculty", "faculty"],
  student: ["Asha Sen", "student", "student"],
  hod: ["Dev Iyer", "hod", "hod"],
  admin: ["Mira Bose", "admin", "admin"],
  principal: ["Leela Varma", "principal", "principal"],
  outsider: ["Neel Das", "outsider", "student"],
  replacement: ["Rohan Roy", "replacement", "faculty"],
  tenant: ["Ira Mehta", "tenant", "student"],
} as const;

export const demoPassword = "Nexus-local-demo-only-2026!";
export const demoEmail = (alias: string) => `${alias}@nexus.example.invalid`;
