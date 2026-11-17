# Publish Here We Stew Again

Use `herewestewagain` as the repository name on both services. Run the commands in PowerShell from the project directory. The GitHub owner and Docker Hub namespace can be different.

## GitHub

Create an empty repository named `herewestewagain` and choose its visibility. Leave the README, `.gitignore` and license initialization options blank. [GitHub import guide](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github?platform=windows)

**Repository description**

> A self-hosted cookbook for organizing recipes, cooking step by step, and sharing complete recipes with photos via JSON import and export.

Once the repository exists, connect it to the local `main` branch and push the initial commit.

```powershell
$githubOwner = Read-Host 'GitHub user or organization'
git remote add origin "https://github.com/$githubOwner/herewestewagain.git"
git push -u origin main
```

## Docker Hub

Create a `herewestewagain` repository in your Docker Hub namespace and choose its visibility. [Docker Hub repository setup](https://docs.docker.com/docker-hub/repos/create/)

**Short description**

> Self-hosted cookbook with recipe photos, cooking history, and JSON import/export.

**Repository overview**

Copy the Markdown from [docker-hub.md](docker-hub.md) and replace `DOCKERHUB_NAMESPACE` and `GITHUB_OWNER` with the names you used to create the repositories. [Docker Hub overview editor](https://docs.docker.com/docker-hub/repos/manage/information/#repository-overview)

Tag the locally built image for your namespace and push both release tags. [Docker Hub push guide](https://docs.docker.com/docker-hub/repos/manage/hub-images/push/)

```powershell
$dockerHubNamespace = Read-Host 'Docker Hub namespace'
$image = "$dockerHubNamespace/herewestewagain"
docker login
docker image tag herewestewagain:1.0.0 "${image}:1.0.0"
docker image tag herewestewagain:1.0.0 "${image}:latest"
docker image push "${image}:1.0.0"
docker image push "${image}:latest"
```

To rebuild the local image from this revision, run `docker build --tag herewestewagain:1.0.0 .`.
