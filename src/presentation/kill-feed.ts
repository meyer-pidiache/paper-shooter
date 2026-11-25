export type KillFeedEntry =
  string | { readonly before?: string; readonly killer: string; readonly after: string };
