import { Link } from "react-router-dom";
import { CONTACT_EMAIL } from "../../shared/contact";
import { LegalPage } from "./LegalPage";

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

export function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="October 26, 2026">
      <p className="legal__lead">
        Lawata is a research prototype. By using it you agree to these terms. They are short, and they say what Lawata
        can and cannot tell you.
      </p>

      <h2>What Lawata is for</h2>
      <p>
        Use Lawata for research, for teaching, and as a pointer to where a field check might be worth doing. It is not an
        official monitoring service and it is still changing.
      </p>

      <h2>Plumes are leads, not findings</h2>
      <p>
        A flagged plume means &ldquo;suspicious, verify&rdquo;. It is never a legal determination and never proof that
        anyone did anything wrong. Satellites see the colour of water, not chemicals such as PFAS. Only a water sample
        tested in a laboratory can tell what is in the water.
      </p>
      <p>
        Lawata can suggest a sampling task, but every task waits for a person to approve it. Lawata never sends a field
        team on its own.
      </p>

      <h2>Data and attribution</h2>
      <ul>
        <li>Contains modified Copernicus Sentinel data (2024&ndash;2026).</li>
        <li>
          Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a>, licensed under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
        </li>
        <li>
          Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles from{" "}
          <a href="https://openmaptiles.org/">OpenMapTiles</a> served by{" "}
          <a href="https://openfreemap.org/">OpenFreeMap</a>.
        </li>
      </ul>

      <h2>No warranty</h2>
      <p>
        Lawata is provided as is, without any warranty. Detections can be wrong, late or missing, and the service can be
        unavailable. The Lawata team is not liable for decisions made using it; check anything important on the ground.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&rsquo;t share or misuse researcher accounts, don&rsquo;t try to get around sign-in, and don&rsquo;t try to
        break, overload or probe the service. We may suspend an account that does.
      </p>

      <h2>Privacy</h2>
      <p>
        How Lawata handles personal data is explained in the <Link to="/privacy">Privacy notice</Link>.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: {mail}.</p>
    </LegalPage>
  );
}
