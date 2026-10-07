// Plain definitions shown as dotted-underline hints and listed on the About page.
// [term, abbreviation, definition]

export const GLOSSARY = [
  ["Accelerated approval", "", "An FDA approval based on an early sign of benefit, such as a lab or scan result. The company must then confirm the benefit in further trials."],
  ["Active comparator", "", "A treatment already in use that a new treatment is tested against, instead of a placebo."],
  ["Adverse event", "AE", "Any unwanted medical event in a participant during a trial, whether or not the treatment caused it."],
  ["Amyloid-related imaging abnormalities", "ARIA", "Brain swelling (ARIA-E) or small bleeds (ARIA-H) seen on MRI scans, a known risk of anti-amyloid antibodies."],
  ["Antibody–drug conjugate", "ADC", "An antibody that finds a target on cancer cells, linked to a chemotherapy drug that it delivers into those cells."],
  ["Arm", "", "A group of participants who receive the same treatment, such as the drug arm or the placebo arm."],
  ["BMI", "", "Body mass index: weight in kilograms divided by height in metres squared."],
  ["CDR-SB", "", "Clinical Dementia Rating–Sum of Boxes. Scores memory, thinking and daily function from 0 to 18; higher means more impairment."],
  ["Comparator", "", "What the new treatment is compared against: placebo, a sham procedure, usual care or another treatment."],
  ["Confidence interval", "CI", "A range of values that fit the data. If a 95% CI for a hazard ratio does not include 1, the difference is unlikely to be chance alone."],
  ["Double-blind", "", "Neither participants nor the study team know who gets which treatment, which reduces bias."],
  ["eGFR", "", "Estimated glomerular filtration rate: how well the kidneys filter blood. Lower numbers mean weaker kidney function."],
  ["Ejection fraction", "EF", "The share of blood the heart’s main chamber pumps out with each beat. A healthy heart pumps out over half; 40% or less is called reduced."],
  ["Eligibility criteria", "", "The rules for who can join a trial. Meeting them on paper does not make a person eligible; only the study team decides."],
  ["Endpoint", "", "An outcome measured to judge whether a treatment works. The primary endpoint drives the main conclusion."],
  ["Enrollment", "", "The number of people taking part, or planned to take part."],
  ["Estimand", "", "A precise statement of what effect is being estimated, including how events like stopping treatment are handled."],
  ["Event-driven trial", "", "A trial that runs until a target number of outcome events has happened, rather than for a fixed time."],
  ["Hazard ratio", "HR", "Compares how often an event happens in two groups over time. HR 0.80 means a 20% lower rate in the treatment group."],
  ["HbA1c", "", "A blood test showing average blood sugar over the past two to three months, used to diagnose and monitor diabetes."],
  ["Immunotherapy", "", "A treatment that helps the body’s immune system find and attack cancer cells."],
  ["Interim analysis", "", "A planned look at the data before a trial ends, which can stop a trial early for clear benefit, harm or futility."],
  ["IRB", "", "Institutional Review Board: an ethics committee that approves and monitors research involving people."],
  ["NCT number", "", "The unique number ClinicalTrials.gov gives each registered study, such as NCT04184622."],
  ["NYHA class", "", "New York Heart Association class: a I–IV scale of how much heart failure limits daily activity. Class IV is the most limited."],
  ["Open-label", "", "Everyone knows which treatment each participant receives."],
  ["Overall survival", "OS", "Time from joining the trial until death from any cause."],
  ["Pathological complete response", "pCR", "No invasive cancer found in the tissue removed at surgery after treatment."],
  ["PD-L1", "", "A protein on some cancer cells that switches off attacking immune cells. Some immunotherapies block this signal."],
  ["Phase", "", "Stage of testing. Phase 1 checks safety and dose, phase 2 looks for an effect and the best dose, phase 3 confirms benefit and safety in large groups."],
  ["Placebo", "", "An inactive treatment that looks like the real one, used to separate the drug’s effect from other effects."],
  ["Pre-exposure prophylaxis", "PrEP", "Medicine taken by people without HIV to prevent infection."],
  ["Primary completion date", "", "When the last participant is assessed for the main outcome. Results usually follow months later."],
  ["Progression-free survival", "PFS", "Time until the cancer grows or spreads, or the person dies."],
  ["Sham procedure", "", "A fake version of a procedure, used as the comparison when a placebo pill or injection isn’t possible."],
  ["SGLT2 inhibitor", "", "A class of tablets that make the kidneys remove extra glucose and salt in urine. First used for diabetes, now also for heart and kidney disease."],
  ["Terminated", "", "A registry status meaning the trial stopped early. That can be for clear benefit, safety, futility or business reasons; the record should say which."],
  ["Topline results", "", "A company’s first short summary of trial results, usually in a press release, before a full peer-reviewed paper."],
  ["Vaccine efficacy", "", "How much a vaccine lowers the rate of disease compared with placebo in a trial. 95% means 95% fewer cases."],
];

export const EXTRA_TERMS = [
  ["Randomized", "", "Participants are put into groups by chance, so the groups are alike at the start and differences can be credited to the treatment."],
  ["Recruiting", "", "The trial is currently enrolling participants."],
  ["Sponsor", "", "The company or organization responsible for the trial, usually also its funder."],
  ["Peer-reviewed", "", "Checked by independent experts before a journal published it."],
  ["Primary outcome", "", "The main thing a trial measures to answer its question. The headline conclusion rests on it."],
  ["Secondary outcome", "", "Extra measures that support or add detail to the main result."],
  ["GLP-1", "", "A gut hormone that reduces appetite and helps control blood sugar. Medicines that mimic it are used for diabetes and weight loss."],
];

// Lookup by lower-case term or abbreviation.
export const TERMS = {};
for (const [t, a, d] of [...GLOSSARY, ...EXTRA_TERMS]) {
  TERMS[t.toLowerCase()] = { term: t, def: d };
  if (a) TERMS[a.toLowerCase()] = { term: `${t} (${a})`, def: d };
}
TERMS["phase 1"] = TERMS["phase 2"] = TERMS["phase 3"] = TERMS["phase 2/3"] = TERMS.phase;
TERMS["95% ci"] = TERMS["confidence interval"];
TERMS["sham"] = TERMS["sham procedure"];

// Terms underlined automatically inside summaries (first mention only).
export const AUTO_TERMS = [
  "placebo", "hazard ratio", "95% CI", "ejection fraction", "HbA1c", "eGFR", "BMI", "CDR-SB", "ARIA-E",
  "progression-free survival", "overall survival", "immunotherapy", "antibody–drug conjugate", "PD-L1",
  "sham procedure", "vaccine efficacy", "pathological complete response", "SGLT2 inhibitor", "GLP-1",
  "NYHA class", "Terminated", "topline", "accelerated approval",
];
TERMS["aria-e"] = TERMS["amyloid-related imaging abnormalities"];
TERMS["topline"] = TERMS["topline results"];
