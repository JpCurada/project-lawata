// A local throwaway Postgres only (see e2e/fixtures/reset_db.py, which refuses anything else).
// Start one with:
//   docker run -d --name lawata-e2e-db -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e \
//     -e POSTGRES_DB=lawata -p 55432:5432 postgis/postgis:16-3.4
export const E2E_DATABASE_URL = "postgresql://e2e:e2e@localhost:55432/lawata";

/** Dev mode: the signed-in "dev" researcher. */
export const RESEARCHER_URL = "http://localhost:5173";
/** Same web app against an auth-on API: an anonymous public visitor. */
export const PUBLIC_URL = "http://localhost:5174";

/** The three demo plumes in db/seed/lawata.db. */
export const PLUMES = { artifact: 26, rain: 34, dry: 27 } as const;
