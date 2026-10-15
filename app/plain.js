
/* Plain-language layer: written for readers with no research background. */
const TOPICS = [
  {id:"weight", label:"Weight loss"},
  {id:"heart", label:"Heart"},
  {id:"memory", label:"Memory"},
  {id:"lung", label:"Lung cancer"},
  {id:"breast", label:"Breast cancer"},
  {id:"kidney", label:"Kidneys"}
];
const PLAIN = {
 NCT04184622:{topic:"weight", ask:"Can a weekly shot help people with obesity lose weight?",
  found:"Yes. After about a year and a half, people on the highest dose lost about 21% of their body weight on average. People on a dummy shot lost about 3%.",
  measured:"Everyone was weighed at the start and again after 72 weeks (about a year and a half).",
  safe:"Stomach upset, like nausea, diarrhea or constipation, was common. It was mostly mild and happened while the dose was being raised."},
 NCT03548935:{topic:"weight", ask:"Can semaglutide, the medicine in Wegovy, help people lose weight?",
  found:"Yes. After 68 weeks, people lost about 15% of their body weight on average, compared with about 2% on a dummy shot.",
  measured:"Everyone was weighed at the start and again after 68 weeks (about 16 months).",
  safe:"Stomach upset was common. About 7 in 100 people stopped because of side effects, compared with 3 in 100 on the dummy shot."},
 NCT04881760:{topic:"weight", ask:"Does a new triple-action shot, retatrutide, help with weight loss?",
  found:"In this smaller, earlier study, people on the highest dose lost about 24% of their weight in 48 weeks, compared with about 2% on a dummy shot. Bigger studies are now testing it.",
  measured:"People were weighed after 24 weeks and again after 48 weeks.",
  safe:"Stomach upset was common, especially at higher doses. Heart rate went up a little."},
 NCT05929066:{topic:"weight", ask:"Does retatrutide work in a large study?",
  found:"The company says people on the highest dose lost about 28% of their weight after 80 weeks. Outside experts have not checked these results yet.",
  measured:"Everyone was weighed at the start and again after 80 weeks (about a year and a half).",
  safe:"Stomach upset was common. About 11 in 100 people on the highest dose stopped because of side effects."},
 NCT03574597:{topic:"heart", ask:"Can a weight-loss shot also prevent heart attacks and strokes?",
  found:"Yes. About 6.5 in 100 people on semaglutide had a heart attack, a stroke or died from heart disease, compared with 8 in 100 on a dummy shot. That is about 20% fewer.",
  measured:"The study counted heart attacks, strokes and heart-related deaths over several years.",
  safe:"About 17 in 100 people stopped treatment because of side effects, mostly stomach problems, compared with 8 in 100 on the dummy shot."},
 NCT03036124:{topic:"heart", ask:"Can a diabetes pill help people with a weak heart?",
  found:"Yes. About 16 in 100 people on dapagliflozin got worse or died from heart causes, compared with 21 in 100 on a dummy pill. It helped people with or without diabetes.",
  measured:"The study counted how many people got worse heart failure or died from heart causes, over about a year and a half.",
  safe:"Side effects were uncommon and about the same as with the dummy pill."},
 NCT03057977:{topic:"heart", ask:"Does empagliflozin help people with a weak heart?",
  found:"Yes. About 19 in 100 people on empagliflozin were hospitalized for heart failure or died from heart causes, compared with about 25 in 100 on a dummy pill.",
  measured:"The study counted hospital stays for heart failure and heart-related deaths, over about 16 months.",
  safe:"Genital yeast infections were more common. Serious side effects were not."},
 NCT01035255:{topic:"heart", ask:"Is the heart-failure pill Entresto better than the older standard pill?",
  found:"Yes. About 22 in 100 people on the newer pill died from heart causes or went to hospital, compared with about 27 in 100 on the older pill. The study ended early because the benefit was clear.",
  measured:"The study counted heart-related deaths and hospital stays for heart failure, over about 2 years.",
  safe:"Low blood pressure was more common. Cough and kidney problems were less common than with the older pill."},
 NCT03819153:{topic:"kidney", ask:"Can semaglutide protect the kidneys of people with diabetes?",
  found:"Yes. Serious kidney problems and deaths from kidney or heart causes were about 24% less common than with a dummy shot. The study ended early because the benefit was clear.",
  measured:"The study counted kidney failure, large drops in kidney function, and deaths from kidney or heart causes.",
  safe:"Serious side effects were less common than with the dummy shot. Stomach upset made some people stop."},
 NCT03887455:{topic:"memory", ask:"Can lecanemab slow memory loss in early Alzheimer’s disease?",
  found:"It slowed decline a little. Over 18 months, scores for memory and daily life got worse about 27% more slowly than with a dummy drip. It did not stop the disease.",
  measured:"Doctors rated memory, thinking and everyday abilities at the start and after 18 months.",
  safe:"About 1 in 8 people had brain swelling that showed up on scans, usually without symptoms. Some people reacted to the drip itself."},
 NCT04437511:{topic:"memory", ask:"Can donanemab slow memory loss in early Alzheimer’s disease?",
  found:"It slowed decline a little. Over 76 weeks, scores for memory and daily life got worse about 29% more slowly than with a dummy drip. It did not stop the disease.",
  measured:"Doctors rated memory, thinking and everyday abilities at the start and after 76 weeks.",
  safe:"About 1 in 4 people had brain swelling that showed up on scans. Three deaths were linked to the treatment."},
 NCT02578680:{topic:"lung", ask:"Does adding Keytruda to chemotherapy help people with advanced lung cancer live longer?",
  found:"Yes. After one year, about 69 in 100 people were alive with the combination, compared with about 49 in 100 with chemotherapy alone.",
  measured:"The study tracked how long people lived and how long before the cancer grew.",
  safe:"Serious side effects were about as common in both groups. Kidney and immune-related problems were more common with Keytruda."},
 NCT02511106:{topic:"lung", ask:"Can a daily pill stop lung cancer from coming back after surgery?",
  found:"Yes, for people with a specific gene change (EGFR). Two years later, about 90 in 100 people on osimertinib were alive with no cancer return, compared with about 44 in 100 on a dummy pill.",
  measured:"The study tracked how long people stayed free of cancer after surgery.",
  safe:"Side effects were mostly mild: diarrhea, skin and nail changes, and mouth sores."},
 NCT03734029:{topic:"breast", ask:"Does Enhertu help with advanced breast cancer that has low HER2?",
  found:"Yes. The cancer was held back for about 10 months on average, compared with 5 months on standard chemotherapy, and people lived about 7 months longer.",
  measured:"The study tracked how long the cancer was held back from growing, and how long people lived.",
  safe:"About 1 in 8 people developed lung inflammation. A few cases were fatal."},
 NCT03036488:{topic:"breast", ask:"Does adding Keytruda to chemotherapy help early triple-negative breast cancer?",
  found:"Yes. When surgery was done, no cancer could be found in about 65 in 100 people who got the combination, compared with about 51 in 100 who got chemotherapy alone.",
  measured:"Doctors checked whether any cancer was left at surgery, then followed people for years.",
  safe:"Serious side effects were a little more common (78 vs 73 in 100). Thyroid problems were more frequent with Keytruda."},
 NCT03529110:{topic:"breast", ask:"Is the newer drug Enhertu better than the older one for HER2-positive breast cancer?",
  found:"Yes, by a lot. After a year, the cancer had not grown in about 76 in 100 people on Enhertu, compared with 34 in 100 on the older drug.",
  measured:"The study tracked how long the cancer was held back from growing.",
  safe:"About 1 in 10 people developed lung inflammation. None of these cases were life-threatening in this study."}
};
const VERDICT = {
  0:{key:"stopped", label:"Didn’t work or stopped", why:"The study missed its goal, or it was stopped before the end."},
  5:{key:"filed", label:"Waiting for approval", why:"The company has asked the FDA to approve it."},
  4:{key:"proven", label:"Proven and approved", why:"Tested in a large study, checked by outside experts, and approved by the FDA."},
  3:{key:"works", label:"Shown to work", why:"Published in a medical journal after outside experts checked it. Not approved yet."},
  2:{key:"promising", label:"Promising, not checked yet", why:"Announced by the company. Outside experts have not reviewed the full results yet."},
  1:{key:"early", label:"Results not in yet", why:"The study is planned or still running, so there are no results to report."},
  6:{key:"early", label:"Results posted, no article found", why:"The study team posted its results on the official registry. Our search found no journal article about the study, but searches can miss articles."},
  7:{key:"early", label:"Results posted", why:"The study team posted its results on the official registry."}
};
function plainStatus(s){
  const u = String(s||"").toUpperCase().replace(/[ ,]+/g,"_");
  return ({RECRUITING:"Looking for volunteers", NOT_YET_RECRUITING:"Starting soon", ENROLLING_BY_INVITATION:"Invite only", ACTIVE_NOT_RECRUITING:"Running, not taking new people", COMPLETED:"Finished", TERMINATED:"Stopped early", WITHDRAWN:"Cancelled", SUSPENDED:"Paused"})[u] || (s ? String(s).toLowerCase().replace(/_/g," ").replace(/^\w/,c=>c.toUpperCase()) : "");
}
function plainPhase(p){
  const s = String(p||"");
  if(/4/.test(s)) return "After approval";
  if(/3/.test(s)) return "Final large test";
  if(/2/.test(s)) return "Mid-stage test";
  if(/1/.test(s)) return "Early safety test";
  return s;
}

const NEWS_PLAIN = {
 "2026-09-08|Novartis":["A Novartis drug for a rare muscle disease didn’t work in its final large test","The drug, del-desiran, was meant to improve muscle strength in people with myotonic dystrophy type 1. It did not."],
 "2026-09-06|Novo Nordisk":["Novo Nordisk stopped two heart studies early","An independent group that watches the results said the studies of ziltivekimab were unlikely to show a benefit, so they were stopped."],
 "2026-09-04|AstraZeneca":["FDA approved a new pill for a type of advanced breast cancer","Camizestrant (Etcamah) is for breast cancer that has spread and has a specific gene change. It held the cancer back for about 16 months on average, compared with 9 months on the usual medicine."],
 "2026-09-03|AbbVie":["A new drug helped people with a blood cancer whose earlier treatments stopped working","In 393 people with multiple myeloma, 74 in 100 responded to etentamig, compared with 46 in 100 on standard treatments. Serious infections were more common."],
 "2026-07-23|Eli Lilly":["Retatrutide also helped people with diabetes or heart disease lose weight","In two more large studies, people lost up to about 21 to 23% of their weight in 80 weeks, compared with 3 to 4% on a dummy shot. Lilly plans to ask the FDA for approval in early 2027."],
 "2026-05-21|Eli Lilly":["A new weekly shot led to about 28% weight loss in a large study","The company says people on the highest dose of retatrutide lost about 28% of their weight after 80 weeks. More people stopped at higher doses because of side effects."],
 "2026-04-01|Eli Lilly":["FDA approved a daily weight-loss pill, Foundayo","Orforglipron is a pill, not a shot. In studies, people lost about 11% of their weight over 72 weeks, compared with about 2% on a dummy pill. It can be taken any time of day."],
 "2025-Q4|Eli Lilly":["Lilly asked the FDA to approve its weight-loss pill","The FDA reviewed it on a faster track and approved it in April 2026."],
 "2025-04-14|Pfizer":["Pfizer stopped work on its weight-loss pill","One person in a study showed signs of possible liver damage, so Pfizer ended its work on danuglipron."],
 "2024-07-02|Eli Lilly":["FDA approved donanemab (Kisunla) for early Alzheimer’s disease","It slows memory decline a little. It carries a warning about brain swelling, and people can stop treatment once scans look clear."],
 "2024-03-08|Novo Nordisk":["FDA approved Wegovy to help prevent heart attacks and strokes","This is for adults with heart disease and extra weight, based on the SELECT study. It was the first weight-loss medicine approved for this."],
 "2023-11-08|Eli Lilly":["FDA approved tirzepatide (Zepbound) for weight loss","The approval was based on the SURMOUNT studies, where people lost up to about 21% of their weight."],
 "2023-07-06|Eisai / Biogen":["FDA gave lecanemab (Leqembi) full approval for early Alzheimer’s disease","A large study confirmed it slows memory decline a little. It carries a warning about brain swelling."],
 "2022-08-05|Daiichi Sankyo / AstraZeneca":["FDA approved Enhertu for breast cancer with low HER2","It was the first treatment for this group of patients, based on the DESTINY-Breast04 study."]
};
function plainLink(l){ if(/paper/i.test(l)) return "Read the medical paper"; if(/registry/i.test(l)) return "Official study record"; if(/^FDA/i.test(l)) return "FDA announcements"; if(/newsroom/i.test(l)) return "Company news page"; return `Read the news story (${l.replace(/ release.*$/i,"").replace(/ report$/i,"")})`; }
