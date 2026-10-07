// Site settings. Edit the author links here; empty values are hidden on the page.
export const SITE = {
  name: "TrialSignal",
  author: "Goral Mehta",
  linkedin: "",
  github: "https://github.com/mehtagoral2530/trialsignal",
  // How often followed trials are re-checked while the page is open.
  refreshMinutes: 10,
  // Set by scripts/build-preview.mjs for sandboxed previews that cannot reach
  // ClinicalTrials.gov. The site then runs on its saved snapshot only.
  preview: typeof window !== "undefined" && window.TS_PREVIEW === true,
};
