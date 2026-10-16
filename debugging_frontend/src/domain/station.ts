/**
 * Identity of the bench this console is installed on.
 *
 * Hard-coded for now; would come from the station's provisioning record (or the
 * signed-in operator) once the console is deployed to the floor.
 */
export const STATION = {
  name: "Station 3 · Bay B",
  operator: "g.tan",
} as const;
