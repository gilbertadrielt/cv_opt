import type { DefectDefinition } from "./types";

/**
 * The reference catalogue of physical defects, written once and shared across
 * product families. `knowledge-base.ts` selects the subset that is physically
 * possible for each family; inspectors can then edit their line's copy without
 * touching this file.
 */
export const DEFECT_CATALOG = {
  padDeformation: {
    key: "pad-deformation",
    name: "Deformed contact pad",
    severity: "critical",
    description:
      "One or more pads on the underside of the package are flattened, scored, or laterally displaced — usually from socket misalignment or an over-torqued cooler mount.",
    impacts: [
      "Memory training failures and no-POST at rated DDR5 speeds",
      "PCIe lanes dropped when the pad carries a differential pair",
      "Boots intermittently, worsening after thermal cycling",
    ],
  },
  substrateCrack: {
    key: "substrate-crack",
    name: "Substrate crack",
    severity: "critical",
    description:
      "A fracture in the organic package substrate, typically radiating from a corner or from the die shadow.",
    impacts: [
      "Open or high-resistance trace causing permanent no-POST",
      "Crack propagates in the field — failure recurs after RMA",
      "Not reworkable; disposition is scrap",
    ],
  },
  dieEdgeChip: {
    key: "die-chip",
    name: "Die edge chip",
    severity: "critical",
    description:
      "Silicon loss at a die edge or corner, most often from handling or shear during heat-spreader removal.",
    impacts: [
      "Machine check exceptions under sustained load",
      "Core or cache slice fused off, reducing rated capability",
      "Latent failure weeks after the part returns to service",
    ],
  },
  heatSpreaderGouge: {
    key: "ihs-gouge",
    name: "Heat spreader gouge",
    severity: "major",
    description: "Material removal or deep scoring on the integrated heat spreader lid.",
    impacts: [
      "Uneven cold plate contact and a localized hot spot",
      "Thermal throttling under sustained all-core load",
      "No electrical impact when confined to the lid",
    ],
  },
  surfaceContamination: {
    key: "contamination",
    name: "Surface contamination",
    severity: "cosmetic",
    description:
      "Cured thermal interface material, flux residue, or particulate on the lid or substrate.",
    impacts: [
      "Obscures the surface — clean and rescan before dispositioning",
      "Conductive residue can bridge adjacent pads",
      "Raises measured contact resistance at the socket",
    ],
  },
  thermalDiscoloration: {
    key: "thermal-discoloration",
    name: "Thermal discoloration",
    severity: "major",
    description:
      "Browning or scorching of the solder mask, indicating a localized overtemperature event.",
    impacts: [
      "Points to a VRM overcurrent or cooler mounting fault upstream",
      "Solder joints under the affected area are degraded",
      "Strong predictor of early repeat failure",
    ],
  },
  landSideCapacitor: {
    key: "land-side-cap",
    name: "Damaged land-side capacitor",
    severity: "major",
    description: "A land-side capacitor is cracked, tilted off its pads, or missing entirely.",
    impacts: [
      "Power rail noise and instability under transient load",
      "Short to ground if the capacitor failed closed",
      "Boost clocks unstable or capped below rating",
    ],
  },
  connectorDeformation: {
    key: "connector-deformation",
    name: "Power connector deformation",
    severity: "critical",
    description:
      "Melting, discoloration, or pin recession at the 12V-2x6 or 8-pin power connector housing.",
    impacts: [
      "Overcurrent concentrated on individual conductors",
      "Fire risk — quarantine the unit, do not power on",
      "Contact resistance climbs with every insertion cycle",
    ],
  },
  edgeConnectorWear: {
    key: "edge-connector-wear",
    name: "PCIe edge connector wear",
    severity: "major",
    description: "Plating worn through or corroded on the PCIe gold fingers.",
    impacts: [
      "Link trains down to Gen3 or lower",
      "Device intermittently disappears from the bus",
      "Corrosion continues to spread under the contact",
    ],
  },
  pcbDelamination: {
    key: "pcb-delamination",
    name: "PCB delamination",
    severity: "critical",
    description: "Separation between PCB layers, visible as blistering or a lifted pad region.",
    impacts: [
      "Broken inner-layer connections, often intermittent",
      "Board flexes further under cooler load, widening the void",
      "Not repairable in the field; disposition is scrap",
    ],
  },
  missingComponent: {
    key: "missing-component",
    name: "Missing surface-mount component",
    severity: "critical",
    description:
      "A passive or connector is absent from its footprint, with pads bare or solder disturbed.",
    impacts: [
      "Rail out of regulation or protection circuit defeated",
      "Downstream damage on next power-up",
      "Indicates prior unauthorised rework — check RMA history",
    ],
  },
  heatsinkDamage: {
    key: "heatsink-damage",
    name: "Heatsink fin damage",
    severity: "cosmetic",
    description: "Bent, crushed, or missing fins on the cooler stack.",
    impacts: [
      "Reduced airflow through the affected channel",
      "Fan curve compensates; acoustics rise before temperature does",
      "Cosmetic unless the fin stack contacts a live component",
    ],
  },
  coldPlateScoring: {
    key: "coldplate-scoring",
    name: "Cold plate seat scoring",
    severity: "major",
    description: "Circular scoring or witness marks on the OAM cold plate seating surface.",
    impacts: [
      "Uneven clamp load across the module",
      "Hot spot migration between accelerator dies",
      "Reseat with new TIM before returning to the tray",
    ],
  },
} as const satisfies Record<string, DefectDefinition>;

export type CatalogDefectKey = keyof typeof DEFECT_CATALOG;
