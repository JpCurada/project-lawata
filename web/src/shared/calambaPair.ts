// The Calamba September 2026 before/after pair, cut from docs/images/plume.jpg without its white
// margins (see the one-off split script noted in the web report). Used on Home and in the Story.
import after from "../assets/story/calamba-after.jpg";
import before from "../assets/story/calamba-before.jpg";
import type { PairImage } from "./ui/ImagePair";

export const calambaBefore: PairImage = {
  src: before,
  label: "Sep 18: normal, before the heaviest rain",
  alt: "Sentinel-2 image of the Calamba shore of Laguna de Bay on September 18, 2026: even green water along the built-up shoreline.",
};

export const calambaAfter: PairImage = {
  src: after,
  label: "Sep 25: after a week of rain",
  alt: "Sentinel-2 image of the same Calamba shore on September 25, 2026: brown and dark water spreading from an outlet. Its labels are in Filipino; in English they read: brown head: sediment; dark water: organic matter from the river; river mouth on the Calamba shore.",
};

/** The after image's labels are baked in, in Filipino. Their English meaning, for captions. */
export const calambaLabelsEnglish =
  "Labels (Filipino): brown head = sediment · dark water = organic matter from the river · bunganga = river mouth on the Calamba shore.";
