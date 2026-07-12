export type ImportFormat = "headershim" | "modheader" | "unknown";

export function detectImportFormat(value: unknown): ImportFormat {
  if (isRecord(value)) {
    const { app } = value;
    if (app === "headershim" && Object.hasOwn(value, "schemaVersion")) {
      return "headershim";
    }
  }

  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isRecord) &&
    value.some(hasModHeaderProfileFields)
  ) {
    return "modheader";
  }

  return "unknown";
}

function hasModHeaderProfileFields(profile: Record<string, unknown>): boolean {
  return ["title", "headers", "respHeaders"].some((field) =>
    Object.hasOwn(profile, field),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
