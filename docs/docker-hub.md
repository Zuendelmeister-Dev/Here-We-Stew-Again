# Here We Stew Again

Here We Stew Again is a self-hosted cookbook for people who want a simple way to share recipes using their own resources. The app is free to run on your own hardware, with no app subscription. You can exchange recipes today by sending a JSON file that includes the recipe and all its photos. Direct sharing and connections between independent installations are planned.

- Organize and search recipes, add photos and rate dishes.
- Follow step-by-step directions with timers and log dishes in a cooking calendar.
- Share individual recipes or back up and restore an entire cookbook as JSON.

## Run a new instance

```sh
docker run -d --name herewestewagain --init --restart unless-stopped -p 127.0.0.1:3000:3000 -v herewestewagain-data:/app/data DOCKERHUB_NAMESPACE/herewestewagain:1.0.0
```

Open [http://localhost:3000](http://localhost:3000), sign in with `steward` and `cooksagain`, and set your own credentials during first-run setup. Complete setup before allowing access from other devices.

Recipes, photos, cooking history and account settings are stored in SQLite at `/app/data/kochbuch.sqlite`. The `herewestewagain-data` volume in the example preserves them across container replacements.

## Recover forgotten credentials

Create a temporary recovery account from the Docker host's command line.

```sh
docker exec herewestewagain node recovery.mjs
```

Sign in on the usual app page with the generated username and password, then save the new username and password for the regular account. Saving them removes the recovery account and ends all earlier sessions. The command can run while the app is running.

Each installation has at most one pending recovery account. Running the command again replaces it and invalidates its previous credentials and reset sessions. The credentials persist across restarts until a successful reset or another creation command. Browser reset sessions last 15 minutes. Full details are in the source documentation.

[Source code and documentation](https://github.com/GITHUB_OWNER/herewestewagain)
