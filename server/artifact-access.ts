/**
 * Who may touch a generated artifact or image.
 *
 * Artifacts and visual assets are addressed by id alone (`/api/artifacts/:id`, `/api/visual-assets/:id`, and lists of ids in request
 * bodies), so the project/conversation param guards do not cover them. They belong to the project they were generated for: the
 * caller must own that project (or be the recorded creator). Everything else is "not found", never "forbidden", so ids cannot be probed.
 *
 * Dependencies are injected: this module imports nothing from the database or the server, which is what makes the rule unit-testable
 * (tests/artifact-access.test.ts) and keeps it from joining an import cycle (scripts/check-architecture.mjs).
 */

export interface OwnedRef { projectId?: string | null; userId?: string | null }

export interface ArtifactAccessDeps {
  /** in-memory projects (id -> { user_id }) */
  projects: Map<string, { user_id?: string | null } | any>;
  /** in-memory artifacts (id -> { projectId, userId }) */
  artifacts: Map<string, { projectId?: string | null; userId?: string | null } | any>;
  /** database lookups; may throw or return null */
  getProjectRow: (projectId: string) => { user_id?: string | null } | null | undefined;
  getArtifactRow: (id: string) => { project_id?: string | null } | null | undefined;
  getVisualAssetRow: (id: string) => { project_id?: string | null } | null | undefined;
  /** same-user comparison (ids may be written in different UUID forms) */
  isUserOwner: (ownerId?: string | null, userId?: string | null) => boolean;
}

export function createArtifactAccess(deps: ArtifactAccessDeps) {
  const ownerOfProject = (projectId?: string | null): string | null => {
    if (!projectId) return null;
    const cached = deps.projects.get(String(projectId));
    if (cached) return cached.user_id || null;
    try { return deps.getProjectRow(String(projectId))?.user_id || null; } catch { return null; }
  };

  /** What we know about an artifact id, or null when it is unknown (the route then answers 404 exactly as before). */
  const artifactRef = (id: string): OwnedRef | null => {
    const mem = deps.artifacts.get(id);
    if (mem) return { projectId: mem.projectId, userId: mem.userId };
    try { const row = deps.getArtifactRow(id); return row ? { projectId: row.project_id } : null; } catch { return null; }
  };

  const visualAssetRef = (id: string): OwnedRef | null => {
    try { const row = deps.getVisualAssetRow(id); return row ? { projectId: row.project_id } : null; } catch { return null; }
  };

  const mayAccess = (ref: OwnedRef, callerId: string | null | undefined): boolean =>
    !!callerId && (deps.isUserOwner(ref.userId, callerId) || deps.isUserOwner(ownerOfProject(ref.projectId), callerId));

  return {
    ownerOfProject,
    artifactRef,
    visualAssetRef,
    mayAccess,
    /** true when the artifact is unknown (so the handler can say 404 itself) or the caller may use it */
    mayUseArtifact: (id: string, callerId: string | null | undefined): boolean => {
      const ref = artifactRef(id);
      return !ref || mayAccess(ref, callerId);
    },
    /** true only for an artifact that exists AND is the caller's (for bulk operations, where unknown ids are simply skipped) */
    ownsArtifact: (id: string, callerId: string | null | undefined): boolean => {
      const ref = artifactRef(id);
      return !!ref && mayAccess(ref, callerId);
    },
    mayUseVisualAsset: (id: string, callerId: string | null | undefined): boolean => {
      const ref = visualAssetRef(id);
      return !ref || mayAccess(ref, callerId);
    },
  };
}

export type ArtifactAccess = ReturnType<typeof createArtifactAccess>;
