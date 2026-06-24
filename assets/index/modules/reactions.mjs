export function readReactionPayload(target) {
    return {
        eventId: target.dataset.eventId || "",
        type: target.dataset.reactType || ""
    };
}
