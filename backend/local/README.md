# Local testing (offline DynamoDB)

Test the full site locally — including create-trip / save / vote flows that hit
DynamoDB — **without any AWS credentials and without touching the real account.**

How it works: when `DYNAMODB_ENDPOINT_URL` is set, `src/repos/ddb.py` points boto3
at a local DynamoDB emulator (moto) with dummy credentials. Unset it to go back to
real AWS.

> **Just want everything running?** From the repo's `tripy/` directory run
> `./start_dev.sh` — it starts moto, creates the tables, and starts the backend
> and frontend for you. The steps below are the manual equivalent.

## Ports

The emulator runs on **`:8001`**, not `:8000` — `:8000` is the FastAPI backend's
port (the frontend expects it there). Keeping them separate avoids the collision
where moto squats `:8000` and the backend can't bind.

## One-time setup

```bash
cd backend
./venv/bin/pip install -r local/requirements-local.txt   # installs moto
```

## Each session

1. **Start the emulator** (leave it running in its own terminal):
   ```bash
   backend/local/run_dynamodb_local.sh        # serves http://localhost:8001
   ```
   moto is in-memory — data resets when you stop it.

2. **Create the tables** (re-run after every emulator restart):
   ```bash
   cd backend
   DYNAMODB_ENDPOINT_URL=http://localhost:8001 ./venv/bin/python local/create_local_tables.py
   ```

3. **Start the app as usual.** `backend/.env` already has
   `DYNAMODB_ENDPOINT_URL=http://localhost:8001`, so the server uses local DynamoDB:
   ```bash
   npm run dev          # from repo root — backend + frontend
   ```

Now `POST /solo/trips` and other DB writes succeed locally.

## Going back to real AWS

Comment out `DYNAMODB_ENDPOINT_URL` in `backend/.env` and restart the backend.
(You'll then need real AWS credentials in the server process.)

## Files

- `create_local_tables.py` — creates all tables with the same keys/GSIs as `infra/lib/dbStack.ts`
- `run_dynamodb_local.sh` — starts the moto emulator on `:8001`
- `requirements-local.txt` — local-only deps (moto)
