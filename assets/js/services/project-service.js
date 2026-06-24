import { state } from "../state.js";

export function getActiveProjects() {
  return (state.masterData.projects || []).filter((project) => !project.IsHidden);
}

export function findProjectByName(name) {
  return getActiveProjects().find((project) => project.Title === name);
}
