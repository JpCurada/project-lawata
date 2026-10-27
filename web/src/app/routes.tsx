import type { RouteObject } from "react-router-dom";
import { HowItsBuiltPage } from "../features/about/HowItsBuiltPage";
import { HomePage } from "../features/home/HomePage";
import { PrivacyPage } from "../features/legal/PrivacyPage";
import { TermsPage } from "../features/legal/TermsPage";
import { PlumeDetailPage } from "../features/plumes/PlumeDetailPage";
import { SamplingPage } from "../features/sampling/SamplingPage";
import { StoryDetailPage } from "../features/story/StoryDetailPage";
import { StoryGalleryPage } from "../features/story/StoryGalleryPage";
import { RequireResearcher } from "../shared/auth";
import { AuthCallbackPage } from "./AuthCallbackPage";
import { NotFoundPage } from "./NotFoundPage";
import { RouteError } from "./RouteError";
import { Shell } from "./Shell";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    // If the Shell itself throws, show our error page instead of React Router's raw default.
    errorElement: <RouteError />,
    children: [
      {
        // Pathless layout so render errors and failed lazy chunks show inside the shell.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomePage /> },
          // Lazy so MapLibre (~1 MB) only loads on the map page.
          {
            path: "explore",
            lazy: async () => ({ Component: (await import("../features/explore/ExplorePage")).ExplorePage }),
          },
          { path: "plumes/:plumeId", element: <PlumeDetailPage /> },
          { path: "story", element: <StoryGalleryPage /> },
          { path: "story/:storyId", element: <StoryDetailPage /> },
          {
            path: "sampling",
            element: (
              <RequireResearcher
                title="Sampling"
                intro="When the agent finds a dry-weather plume worth checking, it proposes a field sampling task. Each task waits here until a researcher approves or rejects it: nothing is sampled without a person's yes."
                alternative={{
                  to: "/story/binangonan-may-2026",
                  label: "See a proposal in the Binangonan story",
                  text: "You can still follow a real case from satellite image to sampling proposal, with the agent's recorded run.",
                }}
              >
                <SamplingPage />
              </RequireResearcher>
            ),
          },
          { path: "privacy", element: <PrivacyPage /> },
          { path: "terms", element: <TermsPage /> },
          { path: "how-its-built", element: <HowItsBuiltPage /> },
          { path: "auth/callback", element: <AuthCallbackPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
