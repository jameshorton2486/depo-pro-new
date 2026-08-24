export const RECOVERED_WORKSPACE_RESTORED = "RESTORED";
export const RECOVERED_WORKSPACE_MISSING = "MISSING";
export const RECOVERED_WORKSPACE_UNASSIGNED = "UNASSIGNED";

export function resolveRecoveredWorkspace(depositions, depositionId) {
  if (!depositionId)
    return { kind: RECOVERED_WORKSPACE_UNASSIGNED, deposition: null };
  const deposition = Array.isArray(depositions)
    ? depositions.find((item) => item?.id === depositionId) ?? null
    : null;
  return {
    kind: deposition ? RECOVERED_WORKSPACE_RESTORED : RECOVERED_WORKSPACE_MISSING,
    deposition,
  };
}
