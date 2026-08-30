const listeners = new Set();

export const state = {
  user: null,
  account: null,
  accessToken: null,
  siteId: null,
  lists: {},
  requests: [],
  masterData: {
    projects: [],
    drawingNumbers: [],
    drawingNames: [],
    kwp: [],
    team: [],
    holidays: [],
  },
  loading: false,
  currentRoute: "/dashboard",
  theme: localStorage.getItem("ppg-theme") || "light",
};

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener(state));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setRequests(requests) {
  setState({ requests });
}

export function updateRequest(requestNo, updater) {
  const requests = state.requests.map((request) =>
    request.requestNo === requestNo ? { ...request, ...updater(request) } : request
  );
  setRequests(requests);
}
