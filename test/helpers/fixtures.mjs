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

/** A fake ClinicalTrials.gov: answers /studies (filter.ids, query.term) and /studies/{id} from a mutable map. */
export function fakeRegistry(initial = []) {
  const db = new Map(initial.map((s) => [s.protocolSection.identificationModule.nctId, s]));
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (fetchImpl.fail) return json({ error: "down" }, fetchImpl.fail);
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
  return { db, calls, fetchImpl, set: (s) => db.set(s.protocolSection.identificationModule.nctId, s) };
}
