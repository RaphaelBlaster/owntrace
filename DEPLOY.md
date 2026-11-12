# Deploying OwnTrace (api + mail-worker + rag + redis + caddy)

One image, three roles (`OWNTRACE_ROLE=api|mail-worker|rag`). MongoDB stays on the
host as container `owntrace-mongo`; it is not part of the compose file.

## 1. EC2 and security groups
- t4g.small (1.8 GB), Docker with the compose plugin.
- Inbound: 80 and 443 from anywhere (80 is needed for the ACME challenge; Google Pub/Sub pushes over 443).
  22 only from the admin IP, or use SSM Session Manager and close 22.
- Nothing else is published. api, rag, redis and mongo are reachable only on `owntrace-net`.
- If MongoDB later moves to its own instance, allow 27017 only from the app security group.

## 2. Configure
    cp Caddyfile.example Caddyfile
    for s in api mail-worker rag; do cp env/$s.env.example env/$s.env; done
Fill the values (never commit them). Use one random 32+ character `TRACE_SERVICE_TOKEN` in both
`api.env` and `rag.env`.
- api.env: `TRACE_EXECUTION_MODE=remote`, `TRACE_SERVICE_URL=http://owntrace-trace:5001`.
  The URL host must be `owntrace-trace` (the config rejects other hostnames such as `rag`; compose gives rag that alias).
- rag.env: `TRACE_SERVICE_HOST=0.0.0.0`, `TRACE_SERVICE_PORT=5001`.
- api.env and mail-worker.env: `REDIS_URL=redis://owntrace-redis:6379`.
- All three: `MONGO_URI` pointing at `owntrace-mongo`.
- mail-worker.env: copy `CLIENT_ORIGINS`, `CLIENT_APP_URL` (and `GOOGLE_CLIENT_APP_URL` if set) from api.env.
  Production startup requires them as HTTPS, otherwise the worker crash-loops.

## 3. First migration from the single-container start.sh setup
1. Back up Mongo first, for example
   `docker exec owntrace-mongo mongodump --archive --gzip > mongo-backup.gz`.
   Never drop or reset the database, and keep `owntrace-mongo` running with its volume untouched.
2. Record the old image tags for rollback: `docker ps --format '{{.Names}} {{.Image}}'`.
3. Stop (do not remove) the old app and caddy containers: `docker stop <old-app> <old-caddy>`.
4. Create the network and attach Mongo:
   `docker network create owntrace-net && docker network connect owntrace-net owntrace-mongo`
   (if the network already exists, only run the connect). Compose treats it as external and never removes it.
5. `docker compose up -d --build`, then `docker compose ps` until all services are healthy.
6. Check `https://owntrace1.duckdns.org/api/health/ready`, sign in, run sync-now and a TRACE chat.

Rollback: `docker compose down` (volumes are kept), then `docker start <old-app> <old-caddy>`
or run the old image tag with the previous start.sh. Mongo data is unchanged.

## 4. Operations
    docker compose up -d --build        # start, or update after git pull
    docker compose stop                 # stop, keeps data
    docker compose ps
    docker compose logs -f api mail-worker rag
Restart one service: `docker compose up -d --build mail-worker`.

## 5. Inspect BullMQ jobs
    docker compose exec redis redis-cli --scan --pattern 'bull:*'
    docker compose exec redis redis-cli zrange bull:<queue>:failed 0 -1
    docker compose exec redis redis-cli hgetall bull:<queue>:<jobId>
The only queue is MAIL_SYNC (`server/src/shared/queue.js`). Pub/Sub and Graph still push to the
HTTPS webhook; the api only enqueues "sync this user" and the mail-worker marks the Mongo sync job due.
The actual mailbox fetch runs in the mail-worker's Mongo sync loop, so a BullMQ job finishes before the
sync does and its 3 attempts only cover queueing errors. Pushes for one user collapse while a job is
pending. Completed jobs are removed; failed jobs are kept for 7 days (max 1000).
Application-detail updates (POST /api/top-k/enrichment) stay inline: they only set a Mongo flag. Redis persists with AOF in the `redis_data` volume and uses
`noeviction`, so a full Redis rejects writes instead of dropping jobs (the api then falls back to inline work).

## 6. Memory
Limits: api 384m, mail-worker 384m, rag 256m, redis 128m, caddy 64m (about 1.2 GB, plus host Mongo).
Watch `docker stats`; add swap if the instance is tight.
