// backend/src/services/assistantTools/reportPack.js
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ SKELETON — NOT REGISTERED in index.js yet. Inert until wired + tested.    │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Bug/feature reporting FROM inside Ask Blossom — one place for the owner to both ask
// about her data AND report a problem. Hands off to the existing feedbackService
// (which already runs on Claude Haiku — the requested model — and opens a GitHub issue).
//
// Why a thin handoff, not a reimplementation: the report flow is multi-turn, takes a
// screenshot, and (per the RFC) should read codebase context — that lives in
// feedbackService. This tool is just the entry seam so "report a bug: X" inside the
// chat starts that flow without the owner leaving the assistant.
//
// The screenshot + codebase-understanding upgrades happen IN feedbackService, not here
// (see RFC §Reporting). Today's feedbackService already: uses Haiku, asks one question
// at a time, and stops asking once it has enough → matches "only ask if it can't infer".
//
// See RFC: docs/superpowers/plans/2026-06-30-assistant-extensions-rfc.md

// import * as feedbackService from '../feedbackService.js';

/**
 * report_issue — start a bug/feature report from the assistant.
 *
 * @param {{
 *   text: string,            // the owner's description of the bug / feature
 *   type?: 'bug'|'feature',  // optional hint; feedbackService classifies anyway
 * }} input
 * @returns {Promise<{ sessionId:string, done:boolean, question?:string, issueUrl?:string }>}
 */
export async function reportIssueHandler(/* input */) {
  // TODO: const s = await feedbackService.startSession({
  //   text: input.text, appArea: 'dashboard'|'florist', reporterRole: 'owner', reporterName: '<owner>',
  // });
  // return { sessionId: s.sessionId, done: s.done, question: s.question };
  // The assistant relays s.question to the owner; her reply loops back via
  // feedbackService.continueSession until done, then publishSession opens the issue.
  // (Screenshot + codebase context are attached inside feedbackService — see RFC.)
  throw new Error('reportPack.reportIssueHandler not implemented (skeleton)');
}

// Decision needed (see RFC §Reporting): the owner preferred reporting "in one" place.
// Two ways to deliver that, pick one:
//  (A) IN-CHAT TOOL (this file): assistant drives the Q&A; screenshot is harder to
//      attach mid-chat (the chat has no canvas capture) → would need a paste/upload affordance.
//  (B) BUNDLED BUTTON: a "Report a problem" button inside AskBlossomPanel that opens the
//      existing FeedbackModal (which already captures a screenshot). Simplest, keeps the
//      proven screenshot flow, still "one place". RECOMMENDED first step; (A) can follow.
//
// When ready (option A), register in index.js, e.g.:
//   {
//     name: 'report_issue',
//     description: 'File a bug report or feature request. Use when the owner describes something broken or ' +
//       'wishes for a feature ("report a bug: ...", "it would be great if ..."). Starts a short guided report; ' +
//       'relay any follow-up question back to the owner.',
//     input_schema: { /* text (required), type */ },
//     handler: reportIssueHandler,
//   }
