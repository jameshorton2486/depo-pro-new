# Installation and launch

1. Install dependencies with `npm install`.
2. Configure local evidence storage with `npm run configure -- --storage-root "C:\\DepoProData"`. Existing `.env.local` files are protected; use `--force` only after review.
3. Build with `npm run build`.
4. Start with `Start Depo-Pro.cmd` or `npm start`.
5. Open the displayed local URL. Administrator Settings must report production mode, the expected version, and the intended storage root.

The launcher starts both the local API and production UI, refuses occupied ports, checks both services before reporting readiness, and stops both child processes when the launcher is closed with Ctrl+C.
