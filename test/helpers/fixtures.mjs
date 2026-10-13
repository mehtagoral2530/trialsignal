// Builders for ClinicalTrials.gov API v2-shaped study JSON.
export function study({ id, title = "Untitled", acronym = null, status = "RECRUITING", lup = "2026-09-01", start = "2025-01-01", pcd = "2027-06", enroll = 100, phase = ["PHASE3"], conditions = ["Obesity"], interventions = ["Drug X"], summary = "A study." } = {}) {
  return {
    protocolSection: {
      identificationModule: { nctId: id, briefTitle: title, acronym },
      statusModule: { overallStatus: status, startDateStruct: { date: start }, primaryCompletionDateStruct: { date: pcd }, completionDateStruct: { date: pcd }, lastUpdatePostDateStruct: { date: lup } },
      sponsorCollaboratorsModule: { leadSponsor: { name: "Sponsor" } },
      conditionsModule: { conditions },
      designModule: { phases: phase, enrollmentInfo: { count: enroll, type: "ESTIMATED" } },
      armsInterventionsModule: { interventions: interventions.map((name) => ({ type: "DRUG", name })) },
      descriptionModule: { briefSummary: summary },
    },
    hasResults: false,
  };
}

/**
 * A fake ClinicalTrials.gov: answers /studies (filter.ids, query.term) and /studies/{id} from a mutable map.
 * Pass { dataTimestamp } to also answer GET /version like the real registry ({apiVersion, dataTimestamp}); without it
 * /version stays a 404, so existing callers see no change. Registry-side edits are made with set() / mutate(), and
 * bump() moves dataTimestamp forward the way the registry's daily import does.
 */
export function fakeRegistry(initial = [], { dataTimestamp = null } = {}) {
  const db = new Map(initial.map((s) => [s.protocolSection.identificationModule.nctId, s]));
  const calls = [];
  const reg = { db, calls, dataTimestamp };
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (fetchImpl.fail) return json({ error: "down" }, fetchImpl.fail);
    if (u.pathname.endsWith("/version") && reg.dataTimestamp) return json({ apiVersion: "2.0.5", dataTimestamp: reg.dataTimestamp });
    const m = u.pathname.match(/\/studies\/(NCT\d{8})$/);
    if (m) return db.has(m[1]) ? json(db.get(m[1])) : json({}, 404);
    if (u.pathname.endsWith("/studies")) {
      const ids = u.searchParams.get("filter.ids");
      if (ids) return json({ studies: ids.split(",").filter((i) => db.has(i)).map((i) => db.get(i)) });
      const q = (u.searchParams.get("query.term") || "").toLowerCase().split(/\s+/);
      const hits = [...db.values()].filter((s) => q.some((w) => JSON.stringify(s).toLowerCase().includes(w)));
      return json({ studies: hits.slice(0, Number(u.searchParams.get("pageSize") || 10)) });
    }
    return json({}, 404);
  };
  return Object.assign(reg, {
    fetchImpl,
    set: (s) => db.set(s.protocolSection.identificationModule.nctId, s),
    /** Edit a study in place: mutate("NCT…", { status, lup, pcd, enroll }). */
    mutate: (id, { status, lup, pcd, enroll } = {}) => {
      const p = db.get(id).protocolSection;
      if (status !== undefined) p.statusModule.overallStatus = status;
      if (lup !== undefined) p.statusModule.lastUpdatePostDateStruct.date = lup;
      if (pcd !== undefined) p.statusModule.primaryCompletionDateStruct.date = pcd;
      if (enroll !== undefined) p.designModule.enrollmentInfo.count = enroll;
      return db.get(id);
    },
    /** New registry import: dataTimestamp moves forward by `days` (default 1). Returns the new value. */
    bump: (days = 1) => {
      if (!reg.dataTimestamp) throw new Error("fakeRegistry: pass { dataTimestamp } to fakeRegistry() to use bump()");
      return (reg.dataTimestamp = new Date(Date.parse(reg.dataTimestamp + "Z") + days * 864e5).toISOString().slice(0, 19));
    },
  });
}
