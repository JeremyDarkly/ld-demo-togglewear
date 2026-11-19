// The conference stores are built like anyone's, under the names events1 to
// events15, so their host is the only thing that sets them apart. Anything
// meant for the booth only checks this; localhost counts so it can be worked
// on. Browser only: call it after hydration.
export function isEventStore(hostname = window.location.hostname) {
  return hostname === "localhost" || /^events\d+-togglewear\./.test(hostname);
}
