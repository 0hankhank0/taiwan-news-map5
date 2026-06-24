export const eventDisplay = window.TNM_EVENT_DISPLAY || {};

export function hasEventDisplayHelper(name) {
    return typeof eventDisplay[name] === "function";
}
