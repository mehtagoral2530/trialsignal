// Studies with hand-written plain-English summaries. Always polled; never pruned from the watch set.
export const CURATED = [
  "NCT04184622", "NCT03548935", "NCT04881760", "NCT05929066", "NCT03574597", "NCT03887455",
  "NCT04437511", "NCT02578680", "NCT03734029", "NCT03036124", "NCT03057977", "NCT01035255",
  "NCT03819153", "NCT03036488", "NCT03529110", "NCT02511106",
];
// Topic queries refreshed by the snapshot job (feeds the search index and the "recently changed" list).
export const TOPICS = [
  { id: "weight", q: "obesity" },
  { id: "heart", q: "heart failure" },
  { id: "memory", q: "alzheimer" },
  { id: "lung", q: "lung cancer" },
  { id: "breast", q: "breast cancer" },
  { id: "kidney", q: "chronic kidney disease" },
];
