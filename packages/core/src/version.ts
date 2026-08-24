export const AGT004_PROJECT_VERSION = "5.6.0" as const;
export const AGT004_RELEASE_TAG = `v${AGT004_PROJECT_VERSION}` as const;

export function versionedPrompt(agentId: string, purpose?: string): string {
  return [agentId, purpose, `v${AGT004_PROJECT_VERSION}`].filter(Boolean).join("-");
}
