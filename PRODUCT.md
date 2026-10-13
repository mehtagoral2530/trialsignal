# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary (confirmed 2026-10-12): people with no research background at all. These are patients, families and curious readers who heard about a treatment and want to know what a study found, in plain English. Students and people new to health careers are secondary.

## Product Purpose
TrialSignal is an independent research-support website that makes public clinical-trial information easy to follow while keeping the original sources visible. A visitor starts with a trial number and is walked through five questions:

1. What does the study ask?
2. Who is it for?
3. What is tested?
4. How is it measured?
5. What has been found?

Visitors can also follow trials for changes, see recent developments and compare selected developments side by side.

Success means a newcomer understands what a study is testing and how firm its findings are, and knows where to read next.

## Positioning
- TrialSignal labels every finding by how firm it is: registry plan, company announcement, peer-reviewed paper or regulatory decision.
- It reads every record in the same five-question order.
- It is a learning tool built on the public record, not a patient-matching service or a news wire.

## Operating Context
- Information comes from four sources: the ClinicalTrials.gov registry record, the journal publication, company press releases and FDA decisions.
- Visitors arrive with an NCT number or a ClinicalTrials.gov link, or browse a topic.
- Many are on a laptop while studying. Some are on a phone.

## Capabilities and Constraints
- **Pages:** Start, Trials (live search, following, library), the trial reader, Updates (live registry changes, hand-picked headlines, side by side), and About (purpose, scope, sources, how it was built).
- **Live data:** the visitor's browser reads the ClinicalTrials.gov API v2 directly. It checks the registry's `/version` about every 5 minutes and refreshes saved studies only when the registry's data timestamp moves. A Cloudflare Worker with an Upstash Redis cache is kept in `worker/` as an optional path that is not deployed. When running as a claude.ai artifact, the Clinical Trials connector is used instead.
- **Fallback:** a snapshot rebuilt hourly by GitHub Actions (it fetches only when the registry has changed), then a curated library of 16 trials.
- **Browser storage:** notes and followed trials are kept in localStorage.
- **Stack:** static HTML, CSS and JavaScript with no framework, hosted on GitHub Pages (the optional Cloudflare Worker is not deployed). See docs/ARCHITECTURE.md.
- **Simplification is approved** (2026-10-10). The flow may be simplified and features cut or merged where they add clutter.

## Brand Commitments
- Name: TrialSignal.
- Voice: plain, warm and exact. Write at a reading age of 9-11: short sentences, everyday words, and any medical term explained the moment it appears. Never overstate evidence.
- Not playful: no illustrations, jokes or loud colour.
- Light and calm. The user found the previous slate design too dark (2026-10-12).
- The interface must keep cognitive load low: one question per screen, details only on request, few choices at a time.

## Evidence on Hand
- 16 curated trial summaries with peer-reviewed citations (DOIs).
- 14 dated headlines with source links.
- A glossary.
- No testimonials, user numbers or endorsements exist. None may be invented.

## Product Principles
1. The source stays one click away. Summaries orient the reader; they never replace the record.
2. How firm a finding is gets stated every time it appears.
3. One question at a time. Answer first, details on request.
4. Never imply that someone is eligible for a trial, that a treatment suits them, or that one treatment is better than another.

## Accessibility & Inclusion
- Aim for WCAG 2.1 AA.
- Reading is the core task, so body text needs a comfortable measure and real contrast.
- Medical terms are explained in place.
- All data must be verified against the official IRB-approved protocol and investigator brochure before clinical application. This statement must stay visible.
