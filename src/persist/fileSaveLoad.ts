// .harmony.json save/load + re-link audio flow (M6 scope, PRD FR11.2).
export function saveProjectFile(): Promise<void> {
  return Promise.reject(new Error('Project file save lands in M6.'))
}

export function loadProjectFile(_file: File): Promise<void> {
  return Promise.reject(new Error('Project file load lands in M6.'))
}
