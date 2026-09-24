// Helper to extract usernames from various JSON formats
export function extractUsernamesFromJson(data: unknown): string[] {
  if (!data) return [];

  const rawList: unknown[] = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null
    ? (data as Record<string, unknown>).relationships_followers &&
      Array.isArray((data as Record<string, unknown>).relationships_followers)
      ? ((data as Record<string, unknown>).relationships_followers as unknown[])
      : (data as Record<string, unknown>).followers &&
        Array.isArray((data as Record<string, unknown>).followers)
      ? ((data as Record<string, unknown>).followers as unknown[])
      : []
    : [];

  if (rawList.length === 0) return [];

  const usernames: string[] = [];

  for (const item of rawList) {
    if (typeof item === "string") {
      usernames.push(item);
      continue;
    }

    if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;

      // 1. Instagram Export format: string_list_data[].value
      if (Array.isArray(rec.string_list_data) && rec.string_list_data.length > 0) {
        for (const entry of rec.string_list_data) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as Record<string, unknown>).value === "string"
          ) {
            usernames.push((entry as Record<string, unknown>).value as string);
          }
        }
        continue;
      }

      // 2. Apify / direct JSON format: username
      if (typeof rec.username === "string") {
        usernames.push(rec.username);
        continue;
      }
    }
  }

  return usernames;
}
