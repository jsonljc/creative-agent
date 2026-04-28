// Lives in its own module so SP4's PcdIdentitySnapshot writer can pin this
// constant without importing the resolver. Do not inline into registry-resolver.ts.
export const PCD_SHOT_SPEC_VERSION = "shot-spec@1.0.0";
