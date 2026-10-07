// Hand-picked developments. A selection for learning, not a complete news service.
// The registry feed on the Updates page is live; this list is reviewed by hand.

export const NEWS_REVIEWED = "2026-10-06";

export const NEWS_TYPES = {
  Readout: { label: "Results", tone: "info" },
  Approval: { label: "Approval", tone: "ok" },
  Submission: { label: "Filing", tone: "sun" },
  Discontinued: { label: "Stopped", tone: "bad" },
};

export const NEWS = [
  {
    date: "2026-09-08", type: "Readout", company: "Novartis", area: "brain", trial: null,
    title: "Novartis’ del-desiran fails to improve muscle function in phase 3 HARBOR trial for myotonic dystrophy type 1",
    summary: "The pivotal study missed its goal, the company’s second major trial setback within days.",
    evidence: "Company announcement reported by STAT. No full results published yet.",
    links: [["STAT", "https://www.statnews.com/pharmalot/2026/09/08/novartis-reports-second-trial-failure-novo-nordisk-setback/"]],
  },
  {
    date: "2026-09-06", type: "Discontinued", company: "Novo Nordisk", area: "heart", trial: null,
    title: "Novo Nordisk stops the HERMES and ATHENA heart trials of ziltivekimab",
    summary: "An independent data monitoring committee judged the trials unlikely to succeed. The earlier ZEUS trial had found the drug lowered inflammation markers but did not reduce heart attacks or deaths.",
    evidence: "Company decision reported by STAT.",
    links: [["STAT", "https://www.statnews.com/pharmalot/2026/09/08/novartis-reports-second-trial-failure-novo-nordisk-setback/"]],
  },
  {
    date: "2026-09-04", type: "Approval", company: "AstraZeneca", area: "cancer", trial: null,
    title: "FDA approves camizestrant (Etcamah) for ESR1-mutated, ER-positive, HER2-negative metastatic breast cancer",
    short: "FDA approves camizestrant for a kind of advanced breast cancer",
    summary: "Used with a CDK4/6 inhibitor. In SERENA-6 (NCT04964934), median progression-free survival was 16.0 months vs 9.2 months when staying on an aromatase inhibitor.",
    evidence: "Regulatory decision based on phase 3 data.",
    links: [["AJMC roundup", "https://www.ajmc.com/view/5-notable-fda-approvals-from-the-first-half-of-september"], ["Registry record", "https://clinicaltrials.gov/study/NCT04964934"]],
  },
  {
    date: "2026-09-03", type: "Readout", company: "AbbVie", area: "cancer", trial: null,
    title: "Etentamig beats standard treatments in phase 3 CERVINO trial for relapsed multiple myeloma",
    summary: "In 393 patients, response rate was 74.0% vs 45.7%, with a 60% lower risk of disease progression (HR 0.40). Grade 3–4 infections were more common (27.7% vs 19.2%).",
    evidence: "Topline, company-reported. Full data presented at the International Myeloma Society meeting.",
    links: [["AbbVie release", "https://news.abbvie.com/2026-09-03-AbbVie-Announces-Positive-Topline-Results-from-the-Phase-3-CERVINO-Trial-Showing-Etentamig-Significantly-Improved-Response-Rate-and-Progression-Free-Survival-in-Patients-with-Relapsed-Refractory-Multiple-Myeloma"], ["Registry record", "https://clinicaltrials.gov/study/NCT06158841"]],
  },
  {
    date: "2026-07-23", type: "Readout", company: "Eli Lilly", area: "metabolic", trial: "NCT05929066",
    title: "Retatrutide succeeds in TRIUMPH-2 (type 2 diabetes) and TRIUMPH-3 (severe obesity with heart disease)",
    summary: "At 80 weeks, weight fell up to 20.8% (TRIUMPH-2) and 22.6% (TRIUMPH-3) vs 3–4% with placebo; A1c dropped up to 1.6 points. Lilly plans to file with the FDA in the first quarter of 2027.",
    evidence: "Topline, company-reported. No peer-reviewed paper yet.",
    links: [["Lilly release (BioSpace)", "https://www.biospace.com/press-releases/lillys-triple-agonist-retatrutide-successful-in-two-additional-phase-3-obesity-trials-delivering-significant-improvements-in-weight-and-a1c"]],
  },
  {
    date: "2026-05-21", type: "Readout", company: "Eli Lilly", area: "metabolic", trial: "NCT05929066",
    title: "Retatrutide meets primary endpoints in phase 3 TRIUMPH-1, with up to 28.3% average weight loss at 80 weeks",
    summary: "First phase 3 results for the triple-receptor medicine. The 12 mg dose reached 30.3% average weight loss at 104 weeks. Stopping because of side effects rose with dose.",
    evidence: "Topline, company-reported. No peer-reviewed paper yet.",
    links: [["AJMC report", "https://www.ajmc.com/view/retatrutide-achieves-up-to-30-3-average-weight-loss-in-phase-3-triumph-1-trial"], ["Pharmaceutical Journal", "https://pharmaceutical-journal.com/article/news/phase-iii-retatrutide-study-demonstrates-30-weight-loss"]],
  },
  {
    date: "2026-04-01", type: "Approval", company: "Eli Lilly", area: "metabolic", trial: null,
    title: "FDA approves orforglipron (Foundayo), an oral GLP-1 pill, for chronic weight management",
    summary: "Approval rested on the 72-week ATTAIN program: 11.1% average weight loss vs 2.1% with placebo across all treated participants. It can be taken without food or water restrictions.",
    evidence: "Regulatory decision based on phase 3 data.",
    links: [["AJMC", "https://www.ajmc.com/view/fda-approves-lilly-s-oral-glp-1-orforglipron-for-obesity"], ["Consultant360", "https://www.consultant360.com/fda-alerts/fda-approves-orforglipron-foundayo-chronic-weight-management"]],
  },
  {
    date: "2025-Q4", type: "Submission", company: "Eli Lilly", area: "metabolic", trial: null,
    title: "Lilly files orforglipron with the FDA for obesity under the national priority voucher program",
    summary: "The submission was reviewed under the FDA’s new priority voucher program, leading to the April 2026 approval.",
    evidence: "Company statements reported by trade press.",
    links: [["BioPharma Dive", "https://www.biopharmadive.com/news/eli-lilly-orforglipron-maintenance-study-national-priority-voucher-fda/808250/"], ["PharmExec", "https://www.pharmexec.com/view/eli-lilly-submit-oral-glp-fda-priority-review-program-report"]],
  },
  {
    date: "2025-04-14", type: "Discontinued", company: "Pfizer", area: "metabolic", trial: null,
    title: "Pfizer discontinues development of oral GLP-1 candidate danuglipron",
    summary: "Pfizer ended the program after a case of potential drug-induced liver injury in a dose-optimization study, after reviewing the overall data.",
    evidence: "Company press release.",
    links: [["Pfizer newsroom", "https://www.pfizer.com/newsroom/press-releases"]],
  },
  {
    date: "2024-07-02", type: "Approval", company: "Eli Lilly", area: "brain", trial: "NCT04437511",
    title: "FDA approves donanemab (Kisunla) for early symptomatic Alzheimer’s disease",
    summary: "Approval based on TRAILBLAZER-ALZ 2. The label includes a boxed warning for ARIA and allows stopping treatment once amyloid is cleared.",
    evidence: "Regulatory decision; peer-reviewed trial in JAMA (2023).",
    links: [["FDA news", "https://www.fda.gov/news-events/press-announcements"], ["JAMA paper", "https://doi.org/10.1001/jama.2023.13239"]],
  },
  {
    date: "2024-03-08", type: "Approval", company: "Novo Nordisk", area: "heart", trial: "NCT03574597",
    title: "FDA approves Wegovy to reduce cardiovascular risk in adults with obesity or overweight and heart disease",
    summary: "The first weight-management medicine with an indication to reduce heart attack, stroke and cardiovascular death, based on SELECT.",
    evidence: "Regulatory decision; peer-reviewed trial in NEJM (2023).",
    links: [["FDA news", "https://www.fda.gov/news-events/press-announcements"], ["NEJM paper", "https://doi.org/10.1056/NEJMoa2307563"]],
  },
  {
    date: "2023-11-08", type: "Approval", company: "Eli Lilly", area: "metabolic", trial: "NCT04184622",
    title: "FDA approves tirzepatide (Zepbound) for chronic weight management",
    summary: "Approval supported by SURMOUNT-1 and SURMOUNT-2.",
    evidence: "Regulatory decision; peer-reviewed trial in NEJM (2022).",
    links: [["FDA news", "https://www.fda.gov/news-events/press-announcements"], ["NEJM paper", "https://doi.org/10.1056/NEJMoa2206038"]],
  },
  {
    date: "2023-07-06", type: "Approval", company: "Eisai / Biogen", area: "brain", trial: "NCT03887455",
    title: "FDA converts lecanemab (Leqembi) to traditional approval for early Alzheimer’s disease",
    summary: "Converted from accelerated approval after CLARITY AD confirmed clinical benefit on CDR-SB. The label carries a boxed warning for ARIA.",
    evidence: "Regulatory decision; peer-reviewed trial in NEJM (2023).",
    links: [["FDA news", "https://www.fda.gov/news-events/press-announcements"], ["NEJM paper", "https://doi.org/10.1056/NEJMoa2212948"]],
  },
  {
    date: "2022-08-05", type: "Approval", company: "Daiichi Sankyo / AstraZeneca", area: "cancer", trial: "NCT03734029",
    title: "FDA approves trastuzumab deruxtecan (Enhertu) for HER2-low metastatic breast cancer",
    summary: "The first therapy approved for the HER2-low category, based on DESTINY-Breast04.",
    evidence: "Regulatory decision; peer-reviewed trial in NEJM (2022).",
    links: [["FDA news", "https://www.fda.gov/news-events/press-announcements"], ["NEJM paper", "https://doi.org/10.1056/NEJMoa2203690"]],
  },
];
