import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const site = service("radiant-simplicity", {
    source: github("paulocsanz/cabral.sanz", { branch: "main" }),
    replicas: { "us-east4-eqdc4a": 1 },
    healthcheck: "/",
  });

  return project("cabral.sanz.com.br", {
    resources: [site],
  });
});
