export function getRequestedSubmissionId(search = window.location.search) {
  return new URLSearchParams(search).get("submission")?.trim() || "";
}

export function findPublishedSubmission(events, submissionId) {
  return (Array.isArray(events) ? events : []).find((event) =>
    event?.source === "user_submission" && event?.submissionId === submissionId
  ) || null;
}

export function removeSubmissionQuery(locationLike = window.location, historyLike = window.history) {
  const url = new URL(locationLike.href);
  url.searchParams.delete("submission");
  historyLike.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
