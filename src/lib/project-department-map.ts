// Maps "Project" (mssql_asset_history.project — 5 high-level groups)
// to "Department" (assets.department — 11 detailed owner units).
// Used to keep PM Insights' Project filter consistent with asset-level data.

export const PROJECT_TO_DEPARTMENTS: Record<string, string[]> = {
  "7-Eleven": ["Operation 7-Eleven"],
  Airport: ["Airport Media", "Airport Static Media", "Airport Digital Network"],
  Billboard: ["Billboard Media"],
  Digital: ["Digital Media", "Digital Gateway X"],
  Static: ["Static", "Static Media"],
};

const DEPT_TO_PROJECT = new Map<string, string>();
for (const [proj, depts] of Object.entries(PROJECT_TO_DEPARTMENTS)) {
  for (const d of depts) DEPT_TO_PROJECT.set(d, proj);
}

export function departmentsForProjects(projects: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of projects) {
    for (const d of PROJECT_TO_DEPARTMENTS[p] ?? []) out.add(d);
  }
  return out;
}

export function projectForDepartment(department: string | null | undefined): string | null {
  if (!department) return null;
  return DEPT_TO_PROJECT.get(department) ?? null;
}
