import { useTheme } from "../../shared/theme/ThemeProvider";
import deliveryDark from "../../assets/architecture/arch-delivery.png";
import deliveryLight from "../../assets/architecture/arch-delivery-light.png";
import runtimeDark from "../../assets/architecture/arch-runtime.png";
import runtimeLight from "../../assets/architecture/arch-runtime-light.png";
import "./about.css";

type DiagramProps = {
  light: string;
  dark: string;
  alt: string;
  caption: string;
};

/** A dense architecture diagram: the theme's version, scrollable sideways on phones, with a full-size link. */
function Diagram({ light, dark, alt, caption }: DiagramProps) {
  const { theme } = useTheme();
  const src = theme === "dark" ? dark : light;
  return (
    <figure className="about-figure">
      <div className="about-figure__scroll" tabIndex={0} role="group" aria-label={`${caption}, scroll sideways to see all of it`}>
        <img className="about-figure__img" src={src} alt={alt} width={2476} loading="lazy" decoding="async" />
      </div>
      <figcaption className="about-figure__caption">
        {caption}.{" "}
        <a href={src} target="_blank" rel="noreferrer">
          Open full size
        </a>
      </figcaption>
    </figure>
  );
}

export function HowItsBuiltPage() {
  return (
    <article className="page">
      <div className="about">
        <h1 className="page__title">How Lawata is built</h1>
        <p className="about__lead">
          Lawata is a triage tool for water pollution. It scans free Sentinel-2 imagery with OpenCV 5, checks rainfall,
          and lets an agent decide whether to discard a sighting, re-check it on the next pass, or ask a human to approve
          field sampling. It was built for the OpenCV 5 x AWS competition, on the Agentic Vision path.
        </p>

        <h2>The Agentic Vision requirement</h2>
        <p>
          The rule: image results must change a later plan, tool call, action, or request for human approval. A model
          that only explains a fixed vision result does not qualify. This is how Lawata meets it.
        </p>
        <dl className="about__list">
          <dt>Perception</dt>
          <dd>
            OpenCV 5 finds candidate plumes in the daily scan: a water mask, colour distance against a baseline, then
            contours. The agent can then call <code>inspect_plume</code> to look again at full 10 m resolution, and gets
            the crop back as an image.
          </dd>
          <dt>Decision changes with evidence</dt>
          <dd>
            What <code>inspect_plume</code> and <code>get_rainfall</code> return decides the next tool call. A plume
            that disappears at 10 m, or follows heavy rain, is discarded or scheduled for re-check. One that persists in
            dry weather moves toward a sampling request.
          </dd>
          <dt>Action</dt>
          <dd>
            Three outcomes only: discard (<code>mark_artifact</code> or <code>log_expected</code>), schedule a re-check (
            <code>schedule_recheck</code>), or request field sampling (<code>create_sampling_task</code>).
          </dd>
          <dt>Human in the loop</dt>
          <dd>Sampling requests always stop at "Pending approval". Only a signed-in researcher can approve one.</dd>
          <dt>Hard limits in code</dt>
          <dd>
            Each candidate gets at most 6 turns, 8 tool calls and 20,000 tokens. Hitting any limit ends in a scheduled
            re-check, never a guess.
          </dd>
          <dt>Honest limits</dt>
          <dd>
            Satellites see water colour. They cannot see PFAS or prove where a plume came from, so Lawata flags
            sightings as "suspicious, verify".
          </dd>
        </dl>

        <h2>Runtime: what runs when you use Lawata</h2>
        <Diagram
          light={runtimeLight}
          dark={runtimeDark}
          caption="Runtime architecture"
          alt="Runtime architecture. A researcher reaches lawata.org through Route 53 and CloudFront, which serves the dashboard from S3 and forwards /api/* to the lawata-api Lambda after Cognito sign-in. The API starts agent runs on Bedrock AgentCore Runtime. EventBridge Scheduler triggers the lawata-scan Lambda daily, which reads Sentinel-2 image windows from AWS Open Data with OpenCV 5 and starts one AgentCore session per candidate plume. The agent calls Amazon Bedrock and saves evidence crops to S3. Outside AWS: Neon Postgres with PostGIS, Earth Search STAC and Open-Meteo."
        />
        <ol className="about__steps">
          <li>Researchers open lawata.org. CloudFront serves the dashboard build from S3 and forwards /api/*.</li>
          <li>They sign in through Amazon Cognito's hosted page.</li>
          <li>/api/* goes to the lawata-api Lambda (FastAPI), which checks the Cognito token.</li>
          <li>
            <code>POST /api/analyses</code> starts an agent run on Bedrock AgentCore Runtime (<code>lawata_agent</code>
            ).
          </li>
          <li>EventBridge Scheduler triggers the daily scan at 12:00 Manila time.</li>
          <li>
            The lawata-scan Lambda runs OpenCV 5 and reads only the image windows it needs from Sentinel-2 COGs on AWS
            Open Data. It never downloads a full scene.
          </li>
          <li>Each candidate plume gets its own AgentCore session.</li>
          <li>
            The agent talks to Amazon Bedrock (Claude) through the Converse API with tool use. The tools run in the same
            process.
          </li>
          <li>Evidence crops are saved to S3 and kept for 90 days.</li>
          <li>
            Shared services: Route 53 (lawata.org DNS), ECR (2 image repositories), Parameter Store (
            <code>DATABASE_URL</code>), CloudWatch (logs kept 7 days, traces) and AWS Budgets (alerts at $5 and $20).
          </li>
        </ol>
        <p>
          Outside AWS: Neon Postgres with PostGIS holds plumes, reviews and sampling tasks. Earth Search STAC finds new
          Sentinel-2 passes. Open-Meteo supplies the rainfall for the agent's check.
        </p>
        <h3>Reading the diagram</h3>
        <p>
          There are two ways in: a person through CloudFront, and the scheduler through the scan Lambda. Both meet at
          AgentCore. The vision work happens before the agent loop, in the scan, and inside it, when the agent asks for a
          10 m look. Everything is serverless and scales to zero when idle, which is why the budget alerts can sit at $5
          and $20.
        </p>

        <h2>Delivery: how code gets to production</h2>
        <Diagram
          light={deliveryLight}
          dark={deliveryDark}
          caption="Delivery pipeline"
          alt="Delivery pipeline. One repository holds web, api, infra and db. A commit runs pre-commit hooks, a push opens a pull request on GitHub, and GitHub Actions runs api, web and infra checks. After CI passes, a person runs terraform apply in us-west-2, builds arm64 images to ECR for Lambda and AgentCore, syncs the web build to S3 with a CloudFront invalidation, and applies database migrations to Neon."
        />
        <ol className="about__steps">
          <li>
            Code lives in one repository: <code>web/</code> (React, Vite, TypeScript), <code>api/</code> (FastAPI and
            OpenCV 5, Python with uv), <code>infra/</code> (Terraform) and <code>db/</code> (schema and migrations).
          </li>
          <li>
            <code>git commit</code> runs pre-commit hooks: ruff and terraform fmt.
          </li>
          <li>A branch is pushed to GitHub and opened as a pull request into main or staging.</li>
          <li>
            GitHub Actions (<code>ci.yml</code>) runs three jobs. api: ruff, pyright, import-linter, pytest, and an agent
            replay with a mock model. web: npm ci, build and tests. infra: terraform fmt and validate.
          </li>
          <li>Once CI is green, terraform apply creates and updates the resources in us-west-2.</li>
          <li>
            docker buildx builds linux/arm64 images (<code>push_images.sh</code>) and pushes them to ECR. Lambda and
            AgentCore pick up the new image tag.
          </li>
          <li>
            npm run build (<code>deploy_web.sh</code>) syncs the site to S3 and invalidates index.html on CloudFront.
          </li>
          <li>
            Database migrations run with <code>python db/apply_migrations.py</code> against Neon.
          </li>
        </ol>
        <p>
          CI gates every change. That includes replaying the three real demo cases against the agent, so its decisions
          can't drift without someone noticing. Deploys are scripted, but a person runs them; nothing deploys on its own.
        </p>
      </div>
    </article>
  );
}
