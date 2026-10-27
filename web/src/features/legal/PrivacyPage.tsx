import { Link } from "react-router-dom";
import { CONTACT_EMAIL } from "../../shared/contact";
import { LegalPage } from "./LegalPage";

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" updated="October 26, 2026">
      <p className="legal__lead">
        Lawata looks at water, not people. This notice explains the little personal information it does handle, where it
        is kept and how to ask about it.
      </p>

      <h2>Who runs Lawata</h2>
      <p>
        Lawata is built by the Lawata team as a project for the OpenCV 5 x AWS competition. For anything about this
        notice, write to {mail}.
      </p>

      <h2>What Lawata processes</h2>
      <p>
        Most of what Lawata handles is not about people at all: public Sentinel-2 satellite images from the AWS Open Data
        registry, daily rainfall from Open-Meteo, and the plumes Lawata detects in that imagery. None of this is personal
        data.
      </p>

      <h2>Researcher accounts</h2>
      <p>
        Anyone can browse the map and stories without an account. Researchers sign in through Amazon Cognito. Accounts are
        created by invitation only; Cognito holds the username, email address and password for each one, and Lawata reads
        the username and email when someone signs in.
      </p>
      <p>When a signed-in researcher records a decision, Lawata stores it with the record:</p>
      <ul>
        <li>reviewing a plume: the verdict, the optional note, the researcher's username and the time;</li>
        <li>approving or rejecting a sampling task: the decision, the note, the researcher's username and the time.</li>
      </ul>
      <p>These records are kept so the team can see who decided what, and why.</p>

      <h2>Feedback</h2>
      <p>
        The feedback form doesn't send anything to Lawata's servers. It opens your own email app with your message ready
        to send to {mail}. If you send it, we receive an ordinary email, including your address, and keep it only as long
        as we need to answer.
      </p>

      <h2>Cookies and browser storage</h2>
      <p>
        Lawata sets no cookies and uses no analytics, advertising or tracking. It keeps a few small items in your
        browser:
      </p>
      <div className="legal__table-wrap">
        <table className="legal__table">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Where</th>
              <th scope="col">Why</th>
              <th scope="col">How long</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Theme choice</th>
              <td>
                Local storage, <code>lawata-theme</code>
              </td>
              <td>Remembers light or dark, only if you switch it</td>
              <td>Until you clear your browser data</td>
            </tr>
            <tr>
              <th scope="row">Sign-in session</th>
              <td>
                Session storage, keys starting <code>oidc.</code>
              </td>
              <td>Keeps a researcher signed in</td>
              <td>Until you sign out or close the tab</td>
            </tr>
            <tr>
              <th scope="row">Sign-in check</th>
              <td>
                Local storage, keys starting <code>oidc.</code>
              </td>
              <td>Confirms the sign-in that comes back from Cognito is the one you started</td>
              <td>Removed when sign-in completes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The Amazon Cognito sign-in page is run by AWS and sets its own cookies, which sign-in needs. Visitors who never
        sign in don't reach that page.
      </p>

      <h2>Where data is kept</h2>
      <p>
        The site and its API run on Amazon Web Services in the US West (Oregon) region, us-west-2: Amazon CloudFront
        serves the pages, AWS Lambda runs the API, Amazon S3 holds the site files and evidence images, and Amazon Cognito
        holds researcher accounts. Plume records, reviews and sampling tasks are stored in a Neon Postgres database. AWS
        keeps the service's technical logs for 7 days.
      </p>

      <h2>The AI agent</h2>
      <p>
        Lawata's agent runs on Amazon Bedrock. To decide what to do about a plume it reads the satellite image of that
        plume, the rainfall around it and the history of earlier sightings at the same place. It doesn't read researcher
        accounts, reviews or feedback.
      </p>

      <h2>Your rights</h2>
      <p>
        Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173), you can ask to see the personal data we
        hold about you, to correct it, or to delete your researcher account and its data. Email {mail} and say what you
        would like; we will reply as soon as we can.
      </p>

      <h2>Changes to this notice</h2>
      <p>
        If what Lawata does with data changes, we will update this page and its date. See also the{" "}
        <Link to="/terms">Terms of use</Link>.
      </p>
    </LegalPage>
  );
}
