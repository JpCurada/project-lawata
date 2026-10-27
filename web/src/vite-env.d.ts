/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "cognito" (default) signs in through the Cognito hosted UI; "dev" fakes a signed-in researcher. */
  readonly VITE_AUTH_MODE?: "cognito" | "dev";
  /** https://cognito-idp.us-west-2.amazonaws.com/<pool_id> */
  readonly VITE_COGNITO_AUTHORITY?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  /** Hosted UI base URL, used for logout. */
  readonly VITE_COGNITO_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
