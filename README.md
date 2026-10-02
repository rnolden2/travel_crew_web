# Travel Crew Web

The public Travel Crew website and shared-trip preview, built with Vite and a Node server for Cloud Run. This folder is separate from the Flutter app's `web/` runner.

The site describes the current app: Explore, My Trips, Create Trip, Inbox, Profile, AI itinerary import, crew membership, activities, flights, lodging, and expense balances. Payments happen outside the app. The old Travel Chain route remains available as a historical notice; it is no longer promoted as an upcoming app feature. Existing privacy and terms text and effective dates are preserved.

## Local development

Use Node 22.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

The server defaults to port 8080. Static pages work without Google credentials. Shared-trip requests use Application Default Credentials with read access to the configured Firestore database; Places photos additionally require `GOOGLE_MAPS_SERVER_KEY`. Keep credentials out of this folder and browser configuration.

For frontend development, leave the Node server running and run `npm run dev` in a second terminal. Vite proxies `/api` to `WEB_API_TARGET` (default `http://127.0.0.1:8080`). `npm run preview` uses the same proxy.

## Configuration

See `.env.example`. Only the following public settings are exposed by `/runtime-config.js`; server environment values override build-time Vite values, including an explicit empty string.

| Setting | Purpose |
| --- | --- |
| `VITE_APP_STORE_URL` | Released iOS listing; defaults to Travel Crew's App Store page. |
| `VITE_PLAY_STORE_URL` | Verified Android listing. Blank hides the download link. |
| `VITE_APP_SCHEME` | App URL scheme, default `travelcrew`. |
| `VITE_ASSISTANT_BASE_URL` | Deployed assistant service base URL, ending in `/assistant`. Blank hides direct assistant controls. |

`FIRESTORE_DATABASE_ID` defaults to `travel-crew-db-2`. `GOOGLE_MAPS_SERVER_KEY` stays on the server. `GOOGLE_PLACES_API_KEY` and `GOOGLE_MAPS_API_KEY` are accepted as legacy server aliases. The website no longer uses browser Firebase credentials or a waitlist database.

The manual AI import instructions work independently of the assistant service. Enable direct assistant controls only after deploying and verifying the separately implemented assistant backend. The site then offers its `/mcp` connection URL and `/connect` account-management page. Setting this URL does not deploy that backend.

## Shared-trip behavior

`GET /api/shared-trip?tripId=<id>` supplies the `/trip/<id>` preview. The server reads an explicit allowlist of trip, activity, flight, and public crew fields. It never returns expense records, chat, or private account fields.

- Only trips with `isShared: true` are available. A private trip can still have an explicitly created share link, matching the app's sharing behavior.
- Deleted or moderation-removed trips and trips owned by deleted or restricted accounts return 404. Departed, deleted, restricted, and moderation-removed crew profiles are excluded.
- Nested activity and flight records are preferred, with compatibility reads for legacy collections. Reads are capped at 100 records per collection.
- App links use `travelcrew://trips/<UUID>`, matching the current Flutter link parser. Legacy non-UUID previews remain readable without an unsupported app link.
- Opening the app is an explicit action; the page does not automatically redirect users to a store.

`GET /api/place-photo` proxies validated Places photo resource names using the server key. The server accepts GET and HEAD requests only. Historical privacy, terms, and Travel Chain URLs remain supported; `/about-us` redirects to the homepage's About section.

## Verification

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The Node tests cover sharing authorization, deleted/restricted accounts, safe response fields, legacy records, app links, and HTTP behavior using a fake database. Browser checks cover desktop/mobile pages, menus, missing assets, overflow, release-gated controls, clipboard copying, and shared-trip rendering with mocked responses. They do not read production Firestore. Browser tests require local listening ports and Chromium.

## Deployment

`cloudbuild.yaml` builds the Node 22 Docker image, pushes it to the existing Artifact Registry repository, and updates the existing Cloud Run website:

| Setting | Target |
| --- | --- |
| Google Cloud project | `universal-code-135522` |
| Region | `us-central1` |
| Cloud Run service | `travel-crew-web` |
| Artifact Registry repository | Existing `gcr.io` repository |
| Image | `gcr.io/universal-code-135522/travel-crew-web:<build-id>` |
| Existing domain | `travelcrew.app` |

First, create the dedicated build service account from the platform root, while signed in as an administrator who can create service accounts and manage the affected IAM policies:

```sh
npm --prefix travel_crew_web run deploy:setup
```

This creates `travel-crew-web-deploy@universal-code-135522.iam.gserviceaccount.com` and grants:

| Role | Scope / purpose |
| --- | --- |
| `roles/run.developer` | Update the existing `travel-crew-web` service. |
| `roles/artifactregistry.writer` | Push images to the existing `gcr.io` repository in `us`. |
| `roles/storage.objectViewer` | Read uploaded source from `universal-code-135522_cloudbuild`. |
| `roles/logging.logWriter` | Write build logs in the project. |
| `roles/iam.serviceAccountUser` | Deploy using the website's existing runtime service account. |

The command also lets your active gcloud identity select this new build account. To grant that ability to a different submitter, append `-- user:EMAIL` (or `-- serviceAccount:EMAIL`). It reuses an existing account on subsequent runs and does not create keys or deploy. The build submitter still needs their existing Cloud Build submission and source-upload permissions. The runtime account retains Firestore and Maps-secret access; the new account is the Cloud Build execution identity. See Google's [user-managed build accounts](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts) and [Cloud Run deployment roles](https://docs.cloud.google.com/run/docs/deploying).

Then deploy from the platform root:

```sh
npm --prefix travel_crew_web run deploy
```

Or from this folder:

```sh
npm run deploy
```

Both commands explicitly select the project and region, regardless of your active gcloud configuration. Only this website folder is uploaded; `.gcloudignore` excludes local environment files, dependencies, generated output, tests, and Git metadata while retaining the website images. There is no dependency on the old checkout. Cloud Build installs dependencies and builds the site remotely, so no local build or Docker installation is needed for deployment.

The equivalent Google Cloud command from this folder is:

```sh
gcloud builds submit . --config=cloudbuild.yaml --project=universal-code-135522 --region=us-central1 --gcs-source-staging-dir=gs://universal-code-135522_cloudbuild/source
```

The image is tagged with the unique Cloud Build ID so manual uploads work without a Git commit substitution. See Google's [build substitution documentation](https://docs.cloud.google.com/build/docs/configuring-builds/substitute-variable-values).

Sign in with `gcloud auth login` if needed. `cloudbuild.yaml` selects the dedicated build identity. The deploy command pins the source staging bucket to match its read permission. The setup command changes IAM; the deploy command uses the existing repository and service without changing IAM policies. Allow time for new IAM grants to propagate before the first deployment.

Edit the runtime values in the `substitutions` section of `cloudbuild.yaml`: `_FIRESTORE_DATABASE_ID`, `_APP_STORE_URL`, `_PLAY_STORE_URL`, `_APP_SCHEME`, and `_ASSISTANT_BASE_URL`. The deploy step maps these to the website's environment variables. Blank Play Store and assistant URLs keep those controls hidden until ready.

Deployment uses `--update-env-vars` to apply these five settings while preserving other environment variables, runtime identity, and domain configuration. See Google's [environment variable documentation](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables).

The deploy step also binds `GOOGLE_MAPS_SERVER_KEY` to the project's Secret Manager secret `kGoogleApiKey` using `--update-secrets`. `_GOOGLE_MAPS_SECRET_VERSION` pins enabled version `1`; update it when rotating the key. Cloud Run reads the value at instance startup; the key is never copied into this YAML, the Docker image, or the browser configuration. The runtime service account needs `roles/secretmanager.secretAccessor` on this secret or an inherited equivalent. Other secret bindings are preserved. See Google's [Cloud Run secret configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

Local `.env` files are not deployed. The assistant Firebase Hosting/service deployment is separate. Creating this configuration and running local checks does not publish either service; the deploy command does publish the website.

## Layout

- `pages/`: homepage, shared-trip preview, legal pages, legacy notice, and 404.
- `src/`: frontend configuration, scripts, and styles.
- `public/`: public runtime-config fallback.
- `server.mjs`: static routes and read-only shared-trip/photo APIs.
- `test/`: Node and Playwright checks.
