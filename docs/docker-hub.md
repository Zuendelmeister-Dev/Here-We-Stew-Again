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

[Source code and documentation](https://github.com/GITHUB_OWNER/herewestewagain)
