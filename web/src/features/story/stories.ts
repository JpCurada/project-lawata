import calambaTimeline from "../../assets/story/timeline-trimmed.jpg";
import lakeMap from "../../assets/story/map.jpg";
import binangonanRain from "../../assets/story/rain.jpg";
import { calambaAfter, calambaBefore, calambaLabelsEnglish } from "../../shared/calambaPair";
import type { PairImage } from "../../shared/ui/ImagePair";

// The words of each story. Every number (area, rain, coordinates, agent decision, task status) comes
// from the live API, found by place and date, so nothing here can drift from the database.
// Calamba and Binangonan follow docs/Lawata_Story_for_Mai.pdf and the replay-cases skill; the others
// are the largest plume on that date in db/seed (rain checked against v_dry_weather_plumes).

/**
 * Red on the map: little rain, so runoff can't explain it. Blue: heavy rain before, runoff expected.
 * "artifact": not a plume at all (cloud edge, glint), so the rain question doesn't apply.
 */
export type PlumeWeather = "dry_weather" | "after_rain" | "artifact";

export type StoryFigure =
  /** `chart`: drawn on white, so it gets a white "paper" frame that reads well on the dark theme too. */
  | { kind: "image"; src: string; alt: string; caption: string; chart?: boolean }
  | { kind: "pair"; before: PairImage; after: PairImage; caption: string; note?: string };

export interface Story {
  /** URL slug: /story/:id. */
  id: string;
  /** Place name as stored in the database, used to find the live plume. */
  place: string;
  /** ISO date (YYYY-MM-DD) of the Sentinel-2 pass. */
  date: string;
  title: string;
  /** One or two sentences for the gallery card. */
  summary: string;
  weather: PlumeWeather;
  /** Card picture; without one the card uses the live evidence crop, if the plume has one. */
  cover?: { src: string; alt: string };
  figures: StoryFigure[];
  sections: {
    satelliteEvidence: string;
    rainCheck: string;
    /** The rule behind the agent's decision; the decision itself is live. */
    agentRule: string;
    /** For stories with a recorded run: in words, how the evidence changed the agent's next step. */
    runSummary?: string;
    nextStep: string;
  };
}

const dry = {
  rainCheck: "Almost no rain fell in the days before, so runoff can't explain it. Suspicious, verify.",
  nextStep:
    "If the agent proposed field sampling, a person reviews it on the Sampling page. Only a person can approve it; lab samples, not the satellite, tell what is in the water.",
};

const rain = {
  rainCheck:
    "It had rained heavily in the days before. Rivers carry mud into the lake after storms, so murky water here is expected.",
  agentRule: "When recent rain explains a plume, the agent logs it as expected instead of asking for samples.",
  nextStep: "Nothing urgent. The plume stays on record, and anyone can open it, check the evidence and add a review.",
};

export const stories: Story[] = [
  {
    id: "calamba-sep-2026",
    place: "Calamba",
    date: "2026-09-25",
    title: "Calamba, September 2026: a plume after the storm",
    summary: "Brown sediment and dark river water spread from the Calamba shore after a week of rain.",
    weather: "after_rain",
    cover: { src: calambaAfter.src, alt: calambaAfter.alt },
    figures: [
      {
        kind: "pair",
        before: calambaBefore,
        after: calambaAfter,
        caption: "A plume leaves the shore after a week of rain: brown sediment and dark, organic-rich river water.",
        note: calambaLabelsEnglish,
      },
      {
        kind: "image",
        src: calambaTimeline,
        chart: true,
        alt: "Six Sentinel-2 crops of the same Calamba spot from July to October 2026, each above a red and blue change map. Only the September 25 crop shows a strong red patch and a detected plume.",
        caption:
          "Six dates at the same spot, each compared with its usual look. Red means more unusual than normal. Only September 25 passed every check.",
      },
    ],
    sections: {
      satelliteEvidence:
        "OpenCV compares each new image with how this stretch of shore usually looks. On September 25 a large patch of brown and dark water stood out from the Calamba shoreline.",
      ...rain,
      runSummary:
        "It looked at the 10 m image, saw real plume water, then checked the rain. A wet week explained it, so it logged it as expected instead of asking for samples.",
    },
  },
  {
    id: "binangonan-may-2026",
    place: "Binangonan",
    date: "2026-05-06",
    title: "Binangonan, May 2026: a plume with no rain",
    summary: "Unusual water at the river mouth in the dry season, before the July fish kill. Worth a field check.",
    weather: "dry_weather",
    // No cover: a dense chart doesn't read at card size, so the card shows the live evidence crop.
    figures: [
      {
        kind: "image",
        src: lakeMap,
        chart: true,
        alt: "Map of Laguna de Bay with every plume found from January 2024 to October 2026. Most are small blue circles; a few red circles, including one at Binangonan on the north shore, mark plumes with no rain.",
        caption:
          "Every plume found from January 2024 to October 2026. Blue: after rain (expected). Red: no rain (worth a look).",
      },
      {
        kind: "image",
        src: binangonanRain,
        chart: true,
        alt: "Chart for the Binangonan river mouth from January 2025 to October 2026: blue rain bars and a red line of unusual water. The red line spikes in the 2026 dry season while rain is near zero, before a July 2026 fish kill marker.",
        caption:
          "Binangonan river mouth: unusual water rose in the 2026 dry season while almost no rain fell, before the July fish kill. Not proof, but the kind of lead worth sampling.",
      },
    ],
    sections: {
      satelliteEvidence:
        "In the dry season a plume showed up at the Binangonan river mouth, and similar water had appeared there in earlier dry spells. It could also be shallow water as the lake drops, which is why it needs a field check.",
      rainCheck: dry.rainCheck,
      agentRule:
        "A dry-weather plume at a shore outlet, seen before, is the kind of lead the agent turns into a proposed field sampling task.",
      runSummary:
        "The image showed a brown plume on the shore, the rain check came back dry, and the history showed unusual water here before, so it proposed field sampling. The task waits as pending approval: only a person can approve it.",
      nextStep: dry.nextStep,
    },
  },
  {
    id: "pililla-apr-2026",
    place: "Pililla",
    date: "2026-04-21",
    title: "Pililla, April 2026: a cloud, not a plume",
    summary: "The satellite flagged dark water off Pililla. A closer look at 10 m showed it hugging the edge of a cloud.",
    weather: "artifact",
    figures: [],
    sections: {
      satelliteEvidence:
        "On April 21 the satellite flagged a patch of unusually dark water off Pililla, on the lake's east shore. Dark patches can be runoff, but they can also be cloud shadow or haze at a cloud's edge, and the coarse first scan can't tell them apart.",
      rainCheck:
        "Little rain had fallen that week. It didn't come to that: the 10 m image already explained the patch, so rain had nothing left to explain. The live record leaves it out of the dry-weather list because a person also reviewed it as an image artifact.",
      agentRule:
        "When the 10 m image shows a cloud edge or glint, the agent marks the patch as an image artifact instead of asking for samples.",
      runSummary: "It looked at the 10 m image first, saw a cloud edge, and stopped there. No rain check, no samples.",
      nextStep:
        "Nothing to sample. The patch stays on record as an image artifact, and anyone can open it, check the evidence and add a review.",
    },
  },
  {
    id: "paete-aug-2025",
    place: "Paete",
    date: "2025-08-04",
    title: "Paete, August 2025: dark water on a dry day",
    summary: "A large patch of dark water off the Paete shore with no rain in the three days before.",
    weather: "dry_weather",
    figures: [],
    sections: {
      satelliteEvidence:
        "On August 4 the water off Paete, on the lake's east shore, was much darker than it usually looks. Dark water can carry organic matter, but it can also be shadow, algae or a shallow bottom, so the satellite alone can't say which.",
      rainCheck: dry.rainCheck,
      agentRule:
        "A large dry-weather plume is not explained by runoff, so the agent looks closer at the 10 m image and the plume history before deciding whether a field sample is worth it.",
      nextStep: dry.nextStep,
    },
  },
  {
    id: "lumban-mar-2026",
    place: "Lumban",
    date: "2026-03-07",
    title: "Lumban, March 2026: three plumes in the dry season",
    summary: "Three separate patches of unusual water near the Lumban shore on one dry-season pass.",
    weather: "dry_weather",
    figures: [],
    sections: {
      satelliteEvidence:
        "On March 7, three patches of unusual water showed up near Lumban, at the lake's south-east corner where rivers meet the shore. This story follows the largest one. Lumban has more plumes on record than any other place on the lake.",
      rainCheck: dry.rainCheck,
      agentRule:
        "A dry-weather plume at a place with repeated sightings is the kind of lead the agent weighs for field sampling, after checking the 10 m image for clouds or artifacts.",
      nextStep: dry.nextStep,
    },
  },
  {
    id: "lumban-sep-2026",
    place: "Lumban",
    date: "2026-09-23",
    title: "Lumban, September 2026: the same shore after the rain",
    summary: "Brown and dark water near Lumban after a wet week, two days before the Calamba plume.",
    weather: "after_rain",
    figures: [],
    sections: {
      satelliteEvidence:
        "On September 23 brown, sediment-laden water and darker water spread near the Lumban shore. It is the same stretch of shore as the March story, but this time the lake had just taken a week of storm rain.",
      ...rain,
    },
  },
  {
    id: "san-pedro-sep-2026",
    place: "San Pedro",
    date: "2026-09-25",
    title: "San Pedro, September 2026: storm runoff on the west shore",
    summary: "On the same pass as Calamba, brown water off San Pedro after heavy rain.",
    weather: "after_rain",
    figures: [],
    sections: {
      satelliteEvidence:
        "The September 25 pass that caught the Calamba plume also showed brown and dark water off San Pedro, on the built-up west shore, where several rivers drain into the lake.",
      ...rain,
    },
  },
];

export const findStory = (id: string | undefined) => stories.find((story) => story.id === id);

/** The explore map, filtered to this story's place and day. */
export const exploreLink = (story: Story) =>
  `/explore?${new URLSearchParams({ place: story.place, from: story.date, to: story.date }).toString()}`;
